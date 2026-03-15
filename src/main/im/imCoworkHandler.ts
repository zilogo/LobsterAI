/**
 * IM Cowork Handler
 * Adapter that enables IM (DingTalk/Feishu/Telegram) to use CoworkRunner for tool-enabled AI execution
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { CoworkRunner, PermissionRequest } from '../libs/coworkRunner';
import type { CoworkStore, CoworkMessage } from '../coworkStore';
import type { IMStore } from './imStore';
import type { IMMessage, IMPlatform, IMMediaAttachment } from './types';
import { buildIMMediaInstruction } from './imMediaInstruction';

interface MessageAccumulator {
  messages: CoworkMessage[];
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
}

interface QueuedIMRequest {
  message: IMMessage;
  replyFn?: (text: string) => Promise<void>;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

interface PendingIMPermission {
  key: string;
  sessionId: string;
  request: PermissionRequest;
  conversationId: string;
  platform: IMPlatform;
  createdAt: number;
  timeoutId?: NodeJS.Timeout;
}

const PERMISSION_CONFIRM_TIMEOUT_MS = 60_000;
const ACCUMULATOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_QUEUED_MESSAGES_PER_SESSION = 5;
const IM_ALLOW_RESPONSE_RE = /^(允许|同意|yes|y)$/i;
const IM_DENY_RESPONSE_RE = /^(拒绝|不同意|no|n)$/i;
const IM_ALLOW_OPTION_LABEL = '允许本次操作';

export interface IMCoworkHandlerOptions {
  coworkRunner: CoworkRunner;
  coworkStore: CoworkStore;
  imStore: IMStore;
  getSkillsPrompt?: () => Promise<string | null>;
}

export class IMCoworkHandler extends EventEmitter {
  private coworkRunner: CoworkRunner;
  private coworkStore: CoworkStore;
  private imStore: IMStore;
  private getSkillsPrompt?: () => Promise<string | null>;

  // Track active sessions' message accumulation
  private messageAccumulators: Map<string, MessageAccumulator> = new Map();

  // Track which sessions are created by IM (to filter events)
  private imSessionIds: Set<string> = new Set();
  private sessionConversationMap: Map<string, { conversationId: string; platform: IMPlatform }> = new Map();
  private pendingPermissionByConversation: Map<string, PendingIMPermission> = new Map();

  // Queue for messages that arrive while session is busy processing
  private pendingIMQueue: Map<string, QueuedIMRequest[]> = new Map();

  // Stream reply functions and sent message tracking
  private sessionReplyFns: Map<string, (text: string) => Promise<void>> = new Map();
  private sentMessageIds: Set<string> = new Set();

  constructor(options: IMCoworkHandlerOptions) {
    super();
    this.coworkRunner = options.coworkRunner;
    this.coworkStore = options.coworkStore;
    this.imStore = options.imStore;
    this.getSkillsPrompt = options.getSkillsPrompt;

    this.setupEventListeners();
  }

  /**
   * Set up event listeners for CoworkRunner
   */
  private setupEventListeners(): void {
    this.coworkRunner.on('message', this.handleMessage.bind(this));
    this.coworkRunner.on('messageUpdate', this.handleMessageUpdate.bind(this));
    this.coworkRunner.on('permissionRequest', this.handlePermissionRequest.bind(this));
    this.coworkRunner.on('complete', this.handleComplete.bind(this));
    this.coworkRunner.on('error', this.handleError.bind(this));
  }

  /**
   * Process an incoming IM message using CoworkRunner
   */
  async processMessage(message: IMMessage, replyFn?: (text: string) => Promise<void>): Promise<string> {
    const pendingPermissionReply = await this.handlePendingPermissionReply(message);
    if (pendingPermissionReply !== null) {
      return pendingPermissionReply;
    }

    try {
      return await this.processMessageInternal(message, false, replyFn);
    } catch (error) {
      if (!this.isSessionNotFoundError(error)) {
        if (this.shouldRetryWithFreshSession(error, message)) {
          console.warn(
            `[IMCoworkHandler] Detected recoverable API 400 for ${message.platform}:${message.conversationId}, recreating session and retrying once`
          );
          return this.processMessageInternal(message, true, replyFn);
        }
        throw error;
      }

      console.warn(
        `[IMCoworkHandler] Cowork session mapping is stale for ${message.platform}:${message.conversationId}, recreating session`
      );
      return this.processMessageInternal(message, true, replyFn);
    }
  }

  private async processMessageInternal(message: IMMessage, forceNewSession: boolean, replyFn?: (text: string) => Promise<void>): Promise<string> {
    const coworkSessionId = await this.getOrCreateCoworkSession(
      message.conversationId,
      message.platform,
      forceNewSession,
      message.senderId,
      message
    );
    this.sessionConversationMap.set(coworkSessionId, {
      conversationId: message.conversationId,
      platform: message.platform,
    });

    // If session is currently processing an IM request (accumulator exists), queue this message
    if (this.messageAccumulators.has(coworkSessionId)) {
      const queue = this.pendingIMQueue.get(coworkSessionId) || [];
      if (queue.length >= MAX_QUEUED_MESSAGES_PER_SESSION) {
        return Promise.resolve('当前消息较多，请稍后再发送。');
      }
      return new Promise<string>((resolve, reject) => {
        queue.push({ message, replyFn, resolve, reject });
        this.pendingIMQueue.set(coworkSessionId, queue);
        console.log(`[IMCoworkHandler] 消息已排队等待处理`, JSON.stringify({
          sessionId: coworkSessionId,
          platform: message.platform,
          queueLength: queue.length,
        }));
      });
    }

    // Store replyFn for streaming individual messages
    if (replyFn) {
      this.sessionReplyFns.set(coworkSessionId, replyFn);
    } else {
      this.sessionReplyFns.delete(coworkSessionId);
    }

    const responsePromise = this.createAccumulatorPromise(coworkSessionId);

    // Start or continue session
    const isActive = this.coworkRunner.isSessionActive(coworkSessionId);
    const formattedContent = this.formatMessageWithMedia(message);
    const systemPrompt = await this.buildSystemPromptWithSkills();
    const hasAvailableSkills = systemPrompt.includes('<available_skills>');
    const session = this.coworkStore.getSession(coworkSessionId);
    if (session && session.systemPrompt !== systemPrompt) {
      // Claude resume sessions may ignore updated system prompt.
      // Reset claudeSessionId so this turn starts a fresh SDK session with new prompt.
      this.coworkStore.updateSession(coworkSessionId, {
        systemPrompt,
        claudeSessionId: null,
      });
      console.log('[IMCoworkHandler] System prompt changed, reset claudeSessionId for IM session', JSON.stringify({
        coworkSessionId,
        platform: message.platform,
      }));
    }
    if (!hasAvailableSkills) {
      console.warn('[IMCoworkHandler] Skills auto-routing prompt missing for current IM turn');
    }

    // 打印完整的输入消息日志
    console.log(`[IMCoworkHandler] 处理消息:`, JSON.stringify({
      platform: message.platform,
      conversationId: message.conversationId,
      coworkSessionId,
      isActive,
      originalContent: message.content,
      formattedContent,
      attachments: message.attachments,
      hasAvailableSkills,
    }, null, 2));

    const onSessionStartError = (error: unknown) => {
      this.rejectAccumulator(
        coworkSessionId,
        error instanceof Error ? error : new Error(String(error))
      );
    };

    if (isActive) {
      this.coworkRunner.continueSession(coworkSessionId, formattedContent, { systemPrompt })
        .catch(onSessionStartError);
    } else {
      this.coworkRunner.startSession(coworkSessionId, formattedContent, {
        workspaceRoot: session?.cwd,
        confirmationMode: 'text',
        systemPrompt,
      }).catch(onSessionStartError);
    }

    return responsePromise;
  }

  /**
   * Get or create a Cowork session for an IM conversation
   */
  private async getOrCreateCoworkSession(
    imConversationId: string,
    platform: IMPlatform,
    forceNewSession: boolean = false,
    senderId?: string,
    message?: IMMessage
  ): Promise<string> {
    if (forceNewSession) {
      const stale = this.imStore.getSessionMapping(imConversationId, platform);
      if (stale) {
        this.imStore.deleteSessionMapping(imConversationId, platform);
        this.imSessionIds.delete(stale.coworkSessionId);
        this.sessionConversationMap.delete(stale.coworkSessionId);
        this.clearPendingPermissionsBySessionId(stale.coworkSessionId);
        this.rejectQueuedMessages(stale.coworkSessionId, new Error('Session reset'));
        this.coworkRunner.stopSession(stale.coworkSessionId);
      }
    }

    // Check existing mapping
    const existing = forceNewSession ? null : this.imStore.getSessionMapping(imConversationId, platform);
    if (existing) {
      const session = this.coworkStore.getSession(existing.coworkSessionId);
      if (!session) {
        console.warn(
          `[IMCoworkHandler] Found stale mapping for ${platform}:${imConversationId}, session ${existing.coworkSessionId} is missing`
        );
        this.imStore.deleteSessionMapping(imConversationId, platform);
        this.imSessionIds.delete(existing.coworkSessionId);
        this.sessionConversationMap.delete(existing.coworkSessionId);
        this.clearPendingPermissionsBySessionId(existing.coworkSessionId);
        this.rejectQueuedMessages(existing.coworkSessionId, new Error('Stale session'));
        this.coworkRunner.stopSession(existing.coworkSessionId);
      } else {
        this.imStore.updateSessionLastActive(imConversationId, platform);
        this.imSessionIds.add(existing.coworkSessionId);
        this.sessionConversationMap.set(existing.coworkSessionId, {
          conversationId: imConversationId,
          platform,
        });
        return existing.coworkSessionId;
      }
    }

    // Create new Cowork session
    return this.createCoworkSessionForConversation(imConversationId, platform, senderId, message);
  }

  private async createCoworkSessionForConversation(
    imConversationId: string,
    platform: IMPlatform,
    senderId?: string,
    message?: IMMessage
  ): Promise<string> {
    // Create new Cowork session
    const config = this.coworkStore.getConfig();
    const title = this.buildSessionTitle(platform, imConversationId, senderId, message);
    const systemPrompt = await this.buildSystemPromptWithSkills();

    const selectedWorkspaceRoot = (config.workingDirectory || '').trim();
    if (!selectedWorkspaceRoot) {
      throw new Error('IM 工作目录未配置，请先在应用中选择任务目录。');
    }
    const resolvedWorkspaceRoot = path.resolve(selectedWorkspaceRoot);
    if (!fs.existsSync(resolvedWorkspaceRoot) || !fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
      throw new Error(`IM 工作目录不存在或无效: ${resolvedWorkspaceRoot}`);
    }

    const session = this.coworkStore.createSession(
      title,
      resolvedWorkspaceRoot,
      systemPrompt,
      'local' // IM always uses local mode
    );

    // Save mapping
    this.imStore.createSessionMapping(imConversationId, platform, session.id);
    this.imSessionIds.add(session.id);
    this.sessionConversationMap.set(session.id, {
      conversationId: imConversationId,
      platform,
    });

    return session.id;
  }

  /**
   * Build a human-readable session title based on platform and sender identity.
   *
   * NIM title rules:
   *   - P2P direct:  "云信-P2P-{senderName|senderId}"
   *   - Team group:  "云信-群聊-{groupName|teamId}"
   *   - QChat:       "云信-圈组-{groupName|channelId}"
   *
   * Other platforms use the original "IM-{platform}-{timestamp}" style.
   */
  private buildSessionTitle(
    platform: IMPlatform,
    _imConversationId: string,
    senderId?: string,
    message?: IMMessage
  ): string {
    if (platform === 'nim') {
      if (message?.chatSubType === 'qchat') {
        const channelLabel = message.groupName || _imConversationId;
        return `云信-圈组-${channelLabel}`;
      }
      if (message?.chatType === 'group') {
        const groupLabel = message.groupName || senderId || _imConversationId;
        return `云信-群聊-${groupLabel}`;
      }
      // P2P direct message
      const peerLabel = message?.senderName || senderId || _imConversationId;
      return `云信-P2P-${peerLabel}`;
    }
    return `IM-${platform}-${Date.now()}`;
  }

  private async buildSystemPromptWithSkills(): Promise<string> {
    const config = this.coworkStore.getConfig();
    const imSettings = this.imStore.getIMSettings();
    const systemPrompt = config.systemPrompt || '';

    // Build media instruction for IM media sending capability
    const mediaInstruction = buildIMMediaInstruction(imSettings);

    let combinedPrompt = systemPrompt;

    if (imSettings.skillsEnabled && this.getSkillsPrompt) {
      const skillsPrompt = await this.getSkillsPrompt();
      if (skillsPrompt) {
        combinedPrompt = combinedPrompt
          ? `${skillsPrompt}\n\n${combinedPrompt}`
          : skillsPrompt;
      }
    }

    // Append media instruction at the end so it's always present
    if (mediaInstruction) {
      combinedPrompt = combinedPrompt
        ? `${combinedPrompt}\n\n${mediaInstruction}`
        : mediaInstruction;
    }

    return combinedPrompt;
  }

  private isSessionNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /^Session\s.+\snot found$/i.test(message.trim());
  }

  private isRecoverableApi400Error(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (!message.includes('400')) {
      return false;
    }

    return (
      message.includes('api error')
      || message.includes('bad_response_status_code')
      || message.includes('invalid chat setting')
      || message.includes('signature: field required')
    );
  }

  private shouldRetryWithFreshSession(error: unknown, message: IMMessage): boolean {
    if (!this.isRecoverableApi400Error(error)) {
      return false;
    }

    const mapping = this.imStore.getSessionMapping(message.conversationId, message.platform);
    if (!mapping) {
      return false;
    }

    const session = this.coworkStore.getSession(mapping.coworkSessionId);
    return Boolean(session?.claudeSessionId);
  }

  /**
   * Handle message event from CoworkRunner
   *
   * When a new message arrives, any previous unsent assistant messages in the
   * accumulator are considered complete (streaming updates have finished) and
   * are sent immediately via replyFn. The newly arrived message is then pushed
   * into the accumulator for future processing.
   */
  private handleMessage(sessionId: string, message: CoworkMessage): void {
    // Only process messages from IM sessions
    if (!this.imSessionIds.has(sessionId)) return;

    // Before adding the new message, flush any completed unsent assistant messages
    this.flushCompletedAssistantMessages(sessionId);

    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      accumulator.messages.push(message);
    }
  }

  /**
   * Handle message update event (streaming content)
   */
  private handleMessageUpdate(sessionId: string, messageId: string, content: string): void {
    // Only process updates from IM sessions
    if (!this.imSessionIds.has(sessionId)) return;

    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      // Update the message content in the accumulator
      const existingIndex = accumulator.messages.findIndex(m => m.id === messageId);
      if (existingIndex >= 0) {
        accumulator.messages[existingIndex].content = content;
      }
    }
  }

  private createConversationKey(conversationId: string, platform: IMPlatform): string {
    return `${platform}:${conversationId}`;
  }

  private createAccumulatorPromise(sessionId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const existingAccumulator = this.messageAccumulators.get(sessionId);
      if (existingAccumulator) {
        // Safety net: should not happen with queue in place
        console.warn(`[IMCoworkHandler] Unexpected: replacing accumulator for session ${sessionId} (should have been queued)`);
        if (existingAccumulator.timeoutId) {
          clearTimeout(existingAccumulator.timeoutId);
        }
        this.messageAccumulators.delete(sessionId);
        existingAccumulator.reject(new Error('Replaced by a newer IM request'));
      }

      const timeoutId = setTimeout(() => {
        const accumulator = this.messageAccumulators.get(sessionId);
        if (accumulator && accumulator.timeoutId === timeoutId) {
          // Exclude already-streamed messages from the timeout reply
          const partialReply = this.formatReply(accumulator.messages, true);
          this.cleanupStreamState(sessionId);
          this.cleanupAccumulator(sessionId);
          if (partialReply) {
            accumulator.resolve(partialReply + '\n\n[处理超时，以上为部分结果]');
          } else {
            // If all messages were already streamed, just resolve empty
            const hasStreamedAny = accumulator.messages.some(
              m => m.type === 'assistant' && m.content && !m.metadata?.isThinking
            );
            if (hasStreamedAny) {
              accumulator.resolve('');
            } else {
              accumulator.reject(new Error('处理超时，请稍后重试'));
            }
          }
        }
      }, ACCUMULATOR_TIMEOUT_MS);

      // Set up message accumulator
      this.messageAccumulators.set(sessionId, {
        messages: [],
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  private rejectAccumulator(sessionId: string, error: Error): void {
    const accumulator = this.messageAccumulators.get(sessionId);
    if (!accumulator) return;
    this.cleanupAccumulator(sessionId);
    accumulator.reject(error);
  }

  private clearPendingPermissionByKey(key: string): PendingIMPermission | null {
    const pending = this.pendingPermissionByConversation.get(key);
    if (!pending) return null;

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingPermissionByConversation.delete(key);
    return pending;
  }

  private clearPendingPermissionsBySessionId(sessionId: string): void {
    const keysToRemove: string[] = [];
    this.pendingPermissionByConversation.forEach((pending, key) => {
      if (pending.sessionId === sessionId) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach((key) => this.clearPendingPermissionByKey(key));
  }

  private buildIMPermissionPrompt(request: PermissionRequest): string {
    const questions = Array.isArray(request.toolInput?.questions)
      ? (request.toolInput.questions as Array<Record<string, unknown>>)
      : [];
    const firstQuestion = questions[0];
    const questionText = typeof firstQuestion?.question === 'string'
      ? firstQuestion.question
      : '';

    return [
      `检测到需要安全确认的操作（工具: ${request.toolName}）。`,
      questionText ? `说明: ${questionText}` : '说明: 当前操作涉及删除或访问任务目录外路径。',
      '请在 60 秒内回复“允许”或“拒绝”。',
    ].join('\n');
  }

  private buildAllowPermissionResult(request: PermissionRequest): PermissionResult {
    if (request.toolName !== 'AskUserQuestion') {
      return {
        behavior: 'allow',
        updatedInput: request.toolInput,
      };
    }

    const input = request.toolInput && typeof request.toolInput === 'object'
      ? { ...(request.toolInput as Record<string, unknown>) }
      : {};
    const rawQuestions = Array.isArray(input.questions)
      ? (input.questions as Array<Record<string, unknown>>)
      : [];

    const answers: Record<string, string> = {};
    rawQuestions.forEach((question) => {
      const questionTitle = typeof question?.question === 'string' ? question.question : '';
      if (!questionTitle) return;
      const options = Array.isArray(question?.options)
        ? (question.options as Array<Record<string, unknown>>)
        : [];
      const preferredOption = options.find((option) => {
        const label = typeof option?.label === 'string' ? option.label : '';
        return label.includes(IM_ALLOW_OPTION_LABEL);
      });
      const fallbackOption = options[0];
      const selectedLabel = typeof preferredOption?.label === 'string'
        ? preferredOption.label
        : (typeof fallbackOption?.label === 'string' ? fallbackOption.label : IM_ALLOW_OPTION_LABEL);
      answers[questionTitle] = selectedLabel;
    });

    return {
      behavior: 'allow',
      updatedInput: {
        ...input,
        answers,
      },
    };
  }

  private async handlePendingPermissionReply(message: IMMessage): Promise<string | null> {
    const key = this.createConversationKey(message.conversationId, message.platform);
    const pending = this.pendingPermissionByConversation.get(key);
    if (!pending) return null;

    const normalizedReply = message.content
      .trim()
      .replace(/[。！!,.，\s]+$/g, '');
    if (!normalizedReply) {
      return '当前有待确认操作，请回复“允许”或“拒绝”（60 秒内）。';
    }

    if (!this.coworkRunner.isSessionActive(pending.sessionId)) {
      this.clearPendingPermissionByKey(key);
      return '该确认请求已过期，请重新发送任务。';
    }

    if (IM_DENY_RESPONSE_RE.test(normalizedReply)) {
      this.clearPendingPermissionByKey(key);
      this.coworkRunner.respondToPermission(pending.request.requestId, {
        behavior: 'deny',
        message: 'Operation denied by IM user confirmation.',
      });
      return '已拒绝本次操作，任务未继续执行。';
    }

    if (!IM_ALLOW_RESPONSE_RE.test(normalizedReply)) {
      return '当前有待确认操作，请回复“允许”或“拒绝”（60 秒内）。';
    }

    this.clearPendingPermissionByKey(key);
    const responsePromise = this.createAccumulatorPromise(pending.sessionId);
    this.coworkRunner.respondToPermission(
      pending.request.requestId,
      this.buildAllowPermissionResult(pending.request)
    );
    return responsePromise;
  }

  /**
   * Handle permission request in IM mode with explicit user confirmation.
   */
  private handlePermissionRequest(sessionId: string, request: PermissionRequest): void {
    // Only process permission requests from IM sessions
    if (!this.imSessionIds.has(sessionId)) return;
    const conversation = this.sessionConversationMap.get(sessionId);
    if (!conversation) {
      this.coworkRunner.respondToPermission(request.requestId, {
        behavior: 'deny',
        message: 'IM session mapping missing for permission request.',
      });
      return;
    }

    const key = this.createConversationKey(conversation.conversationId, conversation.platform);
    const existingPending = this.clearPendingPermissionByKey(key);
    if (existingPending) {
      this.coworkRunner.respondToPermission(existingPending.request.requestId, {
        behavior: 'deny',
        message: 'Superseded by a newer permission request.',
      });
    }

    const timeoutId = setTimeout(() => {
      const currentPending = this.pendingPermissionByConversation.get(key);
      if (!currentPending || currentPending.request.requestId !== request.requestId) {
        return;
      }
      this.clearPendingPermissionByKey(key);
      this.coworkRunner.respondToPermission(request.requestId, {
        behavior: 'deny',
        message: 'Permission request timed out after 60s',
      });
    }, PERMISSION_CONFIRM_TIMEOUT_MS);

    this.pendingPermissionByConversation.set(key, {
      key,
      sessionId,
      request,
      conversationId: conversation.conversationId,
      platform: conversation.platform,
      createdAt: Date.now(),
      timeoutId,
    });

    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      const confirmationPrompt = this.buildIMPermissionPrompt(request);
      this.cleanupAccumulator(sessionId);
      accumulator.resolve(confirmationPrompt);
    }
  }

  /**
   * Handle session complete event
   */
  private handleComplete(sessionId: string): void {
    // Only process complete events from IM sessions
    if (!this.imSessionIds.has(sessionId)) return;

    this.clearPendingPermissionsBySessionId(sessionId);

    // Flush the last assistant message (its streaming is now complete)
    this.flushCompletedAssistantMessages(sessionId);

    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      // Only return content that hasn't been streamed yet
      const replyText = this.formatReply(accumulator.messages, true);

      // 打印完整的输出消息日志
      console.log(`[IMCoworkHandler] 会话完成:`, JSON.stringify({
        sessionId,
        messageCount: accumulator.messages.length,
        replyLength: replyText.length,
        reply: replyText,
      }, null, 2));

      this.cleanupStreamState(sessionId);
      this.cleanupAccumulator(sessionId);
      accumulator.resolve(replyText);
    }

    // Process next queued message if any
    this.processNextQueuedMessage(sessionId);
  }

  /**
   * Handle session error event
   */
  private handleError(sessionId: string, error: string): void {
    // Only process error events from IM sessions
    if (!this.imSessionIds.has(sessionId)) return;

    this.clearPendingPermissionsBySessionId(sessionId);
    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      this.cleanupStreamState(sessionId);
      this.cleanupAccumulator(sessionId);
      accumulator.reject(new Error(error));
    }

    // Process next queued message despite error (give it a chance)
    this.processNextQueuedMessage(sessionId);
  }

  /**
   * Clean up accumulator
   */
  private cleanupAccumulator(sessionId: string): void {
    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator?.timeoutId) {
      clearTimeout(accumulator.timeoutId);
    }
    this.messageAccumulators.delete(sessionId);
  }

  /**
   * Process the next queued IM message for a session
   */
  private processNextQueuedMessage(sessionId: string): void {
    const queue = this.pendingIMQueue.get(sessionId);
    if (!queue || queue.length === 0) {
      this.pendingIMQueue.delete(sessionId);
      return;
    }

    const next = queue.shift()!;
    if (queue.length === 0) {
      this.pendingIMQueue.delete(sessionId);
    }

    console.log(`[IMCoworkHandler] 处理排队消息`, JSON.stringify({
      sessionId,
      platform: next.message.platform,
      remainingQueue: queue.length,
    }));

    this.processMessageInternal(next.message, false, next.replyFn)
      .then(next.resolve)
      .catch(next.reject);
  }

  /**
   * Reject all queued messages for a session
   */
  private rejectQueuedMessages(sessionId: string, error: Error): void {
    const queue = this.pendingIMQueue.get(sessionId);
    if (queue) {
      queue.forEach((item) => item.reject(error));
      this.pendingIMQueue.delete(sessionId);
    }
  }

  /**
   * Flush completed (unsent) assistant messages via replyFn.
   *
   * Called when a new message arrives or when the session completes.
   * By the time a new message event fires, all previous messages in the
   * accumulator have their final content (streaming updates are done).
   */
  private flushCompletedAssistantMessages(sessionId: string): void {
    const replyFn = this.sessionReplyFns.get(sessionId);
    if (!replyFn) return;

    const accumulator = this.messageAccumulators.get(sessionId);
    if (!accumulator) return;

    for (const msg of accumulator.messages) {
      if (
        msg.type === 'assistant' &&
        msg.content &&
        !msg.metadata?.isThinking &&
        !this.sentMessageIds.has(msg.id)
      ) {
        this.sentMessageIds.add(msg.id);
        replyFn(msg.content).catch((err) => {
          console.error(`[IMCoworkHandler] Stream reply failed for message ${msg.id}:`, err);
        });
      }
    }
  }

  /**
   * Clean up stream-related state for a session
   */
  private cleanupStreamState(sessionId: string): void {
    this.sessionReplyFns.delete(sessionId);
    // Clean up sent message IDs belonging to this session's accumulator
    // (sentMessageIds is a flat set; entries are removed in bulk here)
    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      for (const msg of accumulator.messages) {
        this.sentMessageIds.delete(msg.id);
      }
    }
  }

  /**
   * Format accumulated messages into a reply string
   * @param excludeSent - if true, skip messages already sent via stream
   */
  private formatReply(messages: CoworkMessage[], excludeSent: boolean = false): string {
    const parts: string[] = [];

    for (const msg of messages) {
      // Skip user messages (they're the input)
      if (msg.type === 'user') continue;

      // Only include assistant messages in reply (skip thinking messages)
      if (msg.type === 'assistant' && msg.content && !msg.metadata?.isThinking) {
        // Skip messages already streamed to the user
        if (excludeSent && this.sentMessageIds.has(msg.id)) continue;
        parts.push(msg.content);
      }
    }

    return parts.join('\n\n') || '';
  }

  /**
   * Format message content with media attachment information
   * Appends media metadata to content so AI can access the files
   */
  private formatMessageWithMedia(message: IMMessage): string {
    let content = message.content;

    if (message.attachments && message.attachments.length > 0) {
      const mediaInfo = message.attachments.map((att: IMMediaAttachment) => {
        const parts = [`类型: ${att.type}`, `路径: ${att.localPath}`];
        if (att.fileName) parts.push(`文件名: ${att.fileName}`);
        if (att.mimeType) parts.push(`MIME: ${att.mimeType}`);
        if (att.width && att.height) parts.push(`尺寸: ${att.width}x${att.height}`);
        if (att.duration) parts.push(`时长: ${att.duration}秒`);
        if (att.fileSize) parts.push(`大小: ${(att.fileSize / 1024).toFixed(1)}KB`);
        return `- ${parts.join(', ')}`;
      }).join('\n');

      content = content
        ? `${content}\n\n[附件信息]\n${mediaInfo}`
        : `[附件信息]\n${mediaInfo}`;
    }

    return content;
  }

  /**
   * Cleanup when handler is destroyed
   */
  destroy(): void {
    // Clear all pending accumulators
    this.messageAccumulators.forEach((accumulator) => {
      if (accumulator.timeoutId) {
        clearTimeout(accumulator.timeoutId);
      }
      accumulator.reject(new Error('Handler destroyed'));
    });
    this.messageAccumulators.clear();
    // Reject all queued messages
    this.pendingIMQueue.forEach((queue) => {
      queue.forEach((item) => item.reject(new Error('Handler destroyed')));
    });
    this.pendingIMQueue.clear();
    this.imSessionIds.clear();
    this.sessionConversationMap.clear();
    this.sessionReplyFns.clear();
    this.sentMessageIds.clear();

    this.pendingPermissionByConversation.forEach((pending) => {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
    });
    this.pendingPermissionByConversation.clear();

    // Remove event listeners
    this.coworkRunner.removeListener('message', this.handleMessage.bind(this));
    this.coworkRunner.removeListener('messageUpdate', this.handleMessageUpdate.bind(this));
    this.coworkRunner.removeListener('permissionRequest', this.handlePermissionRequest.bind(this));
    this.coworkRunner.removeListener('complete', this.handleComplete.bind(this));
    this.coworkRunner.removeListener('error', this.handleError.bind(this));
  }
}
