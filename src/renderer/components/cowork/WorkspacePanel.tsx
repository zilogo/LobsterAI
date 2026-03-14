import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { i18nService } from '../../services/i18n';
import { getAdapter } from '../../platform';
import {
  ArrowUpTrayIcon,
  FolderPlusIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  DocumentIcon,
  FolderIcon,
  EllipsisVerticalIcon,
  ArrowDownTrayIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { FileEntry } from '../../../shared/types/platform';
import { fileToBase64 } from '../../utils/file';

interface WorkspacePanelProps {
  isOpen: boolean;
  onClose: () => void;
  workingDirectory: string;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const WorkspacePanel: React.FC<WorkspacePanelProps> = ({ isOpen, onClose, workingDirectory }) => {
  const [currentDir, setCurrentDir] = useState(workingDirectory);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<FileEntry | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionErrorTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 显示操作错误提示（3 秒后自动消失）
  const showActionError = useCallback((msg: string) => {
    if (actionErrorTimerRef.current) clearTimeout(actionErrorTimerRef.current);
    setActionError(msg);
    actionErrorTimerRef.current = setTimeout(() => setActionError(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (actionErrorTimerRef.current) clearTimeout(actionErrorTimerRef.current);
    };
  }, []);

  // workingDirectory 变化时重置
  useEffect(() => {
    if (workingDirectory) {
      setCurrentDir(workingDirectory);
    }
  }, [workingDirectory]);

  const loadDirectory = useCallback(async (dirPath: string) => {
    if (!dirPath) return;
    setLoading(true);
    setError(null);
    try {
      const adapter = getAdapter();
      const result = await adapter.files.list(dirPath);
      if (result.success && result.entries) {
        setEntries(result.entries);
      } else {
        setError(result.error || 'Failed to list directory');
        setEntries([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to list directory');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && currentDir) {
      loadDirectory(currentDir);
    }
  }, [isOpen, currentDir, loadDirectory]);

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  // 自动聚焦新建文件夹输入框
  useEffect(() => {
    if (isCreatingFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [isCreatingFolder]);

  // 自动聚焦重命名输入框
  useEffect(() => {
    if (renamingEntry && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingEntry]);

  const handleRefresh = () => {
    loadDirectory(currentDir);
  };

  const handleNavigate = (entry: FileEntry) => {
    if (entry.isDirectory) {
      setCurrentDir(entry.path);
    }
  };

  const handleNavigateUp = () => {
    // 不超出 workingDirectory
    if (currentDir === workingDirectory) return;
    const parent = currentDir.replace(/[/\\][^/\\]+$/, '');
    if (parent && parent.length >= workingDirectory.length) {
      setCurrentDir(parent);
    }
  };

  // 面包屑路径
  const breadcrumbSegments = useMemo(() => {
    if (!workingDirectory || !currentDir) return [];
    const relative = currentDir.startsWith(workingDirectory)
      ? currentDir.slice(workingDirectory.length)
      : '';
    const parts = relative.split(/[/\\]/).filter(Boolean);
    const segments: { label: string; path: string }[] = [
      { label: workingDirectory.split(/[/\\]/).pop() || '/', path: workingDirectory },
    ];
    let accumulated = workingDirectory;
    for (const part of parts) {
      accumulated = `${accumulated}/${part}`;
      segments.push({ label: part, path: accumulated });
    }
    return segments;
  }, [workingDirectory, currentDir]);

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const adapter = getAdapter();
    const uploads = Array.from(files).map(async (file) => {
      const base64 = await fileToBase64(file);
      return adapter.files.upload({
        dataBase64: base64,
        fileName: file.name,
        targetDir: currentDir,
        mimeType: file.type,
      });
    });

    const results = await Promise.allSettled(uploads);
    const failedFiles = Array.from(files).filter((_, i) => results[i].status === 'rejected');
    if (failedFiles.length > 0) {
      showActionError(`${i18nService.t('workspaceUpload')} failed: ${failedFiles.map(f => f.name).join(', ')}`);
    }

    // 清空 input 以允许重复选择相同文件
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadDirectory(currentDir);
  };

  const handleDownload = async (entry: FileEntry) => {
    setContextMenu(null);
    try {
      const adapter = getAdapter();
      await adapter.files.download(entry.path);
    } catch (err: any) {
      showActionError(`${i18nService.t('workspaceDownload')} failed: ${err.message || entry.name}`);
    }
  };

  const handleStartRename = (entry: FileEntry) => {
    setContextMenu(null);
    setRenamingEntry(entry);
    setRenameValue(entry.name);
  };

  const handleRenameSubmit = async () => {
    if (!renamingEntry || !renameValue.trim() || renameValue === renamingEntry.name) {
      setRenamingEntry(null);
      return;
    }

    try {
      const adapter = getAdapter();
      const newPath = renamingEntry.path.replace(/[/\\][^/\\]+$/, `/${renameValue.trim()}`);
      const result = await adapter.files.rename(renamingEntry.path, newPath);
      if (!result.success) {
        showActionError(`${i18nService.t('workspaceRename')} failed: ${result.error}`);
      }
    } catch (err: any) {
      showActionError(`${i18nService.t('workspaceRename')} failed: ${err.message}`);
    }
    setRenamingEntry(null);
    loadDirectory(currentDir);
  };

  const handleStartDelete = (entry: FileEntry) => {
    setContextMenu(null);
    setConfirmDelete(entry);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    try {
      const adapter = getAdapter();
      const result = await adapter.files.delete(confirmDelete.path);
      if (!result.success) {
        showActionError(`${i18nService.t('workspaceDelete')} failed: ${result.error}`);
      }
    } catch (err: any) {
      showActionError(`${i18nService.t('workspaceDelete')} failed: ${err.message}`);
    }
    setConfirmDelete(null);
    loadDirectory(currentDir);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setIsCreatingFolder(false);
      return;
    }

    try {
      const adapter = getAdapter();
      const newPath = `${currentDir}/${newFolderName.trim()}`;
      const result = await adapter.files.mkdir(newPath);
      if (!result.success) {
        showActionError(`${i18nService.t('workspaceNewFolder')} failed: ${result.error}`);
      }
    } catch (err: any) {
      showActionError(`${i18nService.t('workspaceNewFolder')} failed: ${err.message}`);
    }
    setIsCreatingFolder(false);
    setNewFolderName('');
    loadDirectory(currentDir);
  };

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  if (!isOpen) return null;

  if (!workingDirectory) {
    return (
      <aside className="w-72 shrink-0 border-l dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface/30 bg-claude-surface/30 flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b dark:border-claude-darkBorder border-claude-border">
          <span className="text-sm font-medium dark:text-claude-darkText text-claude-text">
            {i18nService.t('workspaceFiles')}
          </span>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover">
            <XMarkIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-center dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('workspaceNotConfigured')}
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-72 shrink-0 border-l dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface/30 bg-claude-surface/30 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b dark:border-claude-darkBorder border-claude-border shrink-0">
        <span className="text-sm font-medium dark:text-claude-darkText text-claude-text">
          {i18nService.t('workspaceFiles')}
        </span>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover">
          <XMarkIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b dark:border-claude-darkBorder border-claude-border shrink-0">
        <button
          type="button"
          onClick={handleUpload}
          className="p-1.5 rounded-md hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          title={i18nService.t('workspaceUpload')}
        >
          <ArrowUpTrayIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
        </button>
        <button
          type="button"
          onClick={() => { setIsCreatingFolder(true); setNewFolderName(''); }}
          className="p-1.5 rounded-md hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          title={i18nService.t('workspaceNewFolder')}
        >
          <FolderPlusIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          className="p-1.5 rounded-md hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          title={i18nService.t('workspaceRefresh')}
        >
          <ArrowPathIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 text-xs overflow-x-auto shrink-0 dark:text-claude-darkTextSecondary text-claude-textSecondary">
        {breadcrumbSegments.map((seg, idx) => (
          <React.Fragment key={seg.path}>
            {idx > 0 && <ChevronRightIcon className="h-3 w-3 shrink-0 opacity-40" />}
            <button
              type="button"
              onClick={() => setCurrentDir(seg.path)}
              className={`shrink-0 px-1 py-0.5 rounded hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover truncate max-w-[100px] ${
                idx === breadcrumbSegments.length - 1
                  ? 'dark:text-claude-darkText text-claude-text font-medium'
                  : ''
              }`}
            >
              {seg.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 border-2 border-claude-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="px-3 py-4 text-sm text-red-500">{error}</div>
        )}

        {/* 操作错误提示（自动消失） */}
        {actionError && (
          <div className="mx-3 mt-1.5 px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg">
            {actionError}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="px-3 py-8 text-sm text-center dark:text-claude-darkTextSecondary text-claude-textSecondary">
            {i18nService.t('workspaceEmpty')}
          </div>
        )}

        {/* Parent directory entry */}
        {!loading && currentDir !== workingDirectory && (
          <button
            type="button"
            onClick={handleNavigateUp}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors text-left"
          >
            <FolderIcon className="h-4 w-4 shrink-0 text-claude-accent" />
            <span className="dark:text-claude-darkTextSecondary text-claude-textSecondary">..</span>
          </button>
        )}

        {/* New folder inline input */}
        {isCreatingFolder && (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <FolderIcon className="h-4 w-4 shrink-0 text-claude-accent" />
            <input
              ref={newFolderInputRef}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderName(''); }
              }}
              onBlur={handleCreateFolder}
              placeholder={i18nService.t('workspaceNewFolderName')}
              className="flex-1 min-w-0 text-sm px-1.5 py-0.5 rounded border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkBg bg-claude-bg dark:text-claude-darkText text-claude-text focus:outline-none focus:ring-1 focus:ring-claude-accent"
            />
          </div>
        )}

        {/* File entries */}
        {!loading && entries.map((entry) => (
          <div
            key={entry.path}
            className="group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors cursor-pointer"
            onClick={() => handleNavigate(entry)}
            onContextMenu={(e) => handleContextMenu(e, entry)}
          >
            {entry.isDirectory ? (
              <FolderIcon className="h-4 w-4 shrink-0 text-claude-accent" />
            ) : (
              <DocumentIcon className="h-4 w-4 shrink-0 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
            )}

            {renamingEntry?.path === entry.path ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') setRenamingEntry(null);
                }}
                onBlur={handleRenameSubmit}
                className="flex-1 min-w-0 text-sm px-1.5 py-0.5 rounded border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkBg bg-claude-bg dark:text-claude-darkText text-claude-text focus:outline-none focus:ring-1 focus:ring-claude-accent"
              />
            ) : (
              <span className="flex-1 min-w-0 truncate dark:text-claude-darkText text-claude-text">
                {entry.name}
              </span>
            )}

            {!entry.isDirectory && !renamingEntry && (
              <span className="shrink-0 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary opacity-0 group-hover:opacity-100 transition-opacity">
                {formatFileSize(entry.size)}
              </span>
            )}

            {/* More actions button */}
            {!renamingEntry && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleContextMenu(e, entry); }}
                className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-all"
              >
                <EllipsisVerticalIcon className="h-4 w-4 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Context Menu — 使用 fixed 定位 + 高 z-index 脱离面板 overflow 裁剪 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[9999] w-44 rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-popover overflow-hidden"
          style={{
            top: contextMenu.y,
            left: Math.max(8, contextMenu.x - 176),
          }}
        >
          {!contextMenu.entry.isDirectory && (
            <button
              type="button"
              onClick={() => handleDownload(contextMenu.entry)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
            >
              <ArrowDownTrayIcon className="h-4 w-4 shrink-0" />
              {i18nService.t('workspaceDownload')}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleStartRename(contextMenu.entry)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm dark:text-claude-darkText text-claude-text hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          >
            <PencilSquareIcon className="h-4 w-4 shrink-0" />
            {i18nService.t('workspaceRename')}
          </button>
          <button
            type="button"
            onClick={() => handleStartDelete(contextMenu.entry)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-500 hover:bg-red-500/10 transition-colors"
          >
            <XMarkIcon className="h-4 w-4 shrink-0" />
            {i18nService.t('workspaceDelete')}
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-xs mx-4 dark:bg-claude-darkSurface bg-claude-surface rounded-2xl shadow-modal overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4">
              <p className="text-sm dark:text-claude-darkText text-claude-text">
                {i18nService.t('workspaceDeleteConfirm')}
              </p>
              <p className="mt-1 text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary truncate">
                {confirmDelete.name}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-3 border-t dark:border-claude-darkBorder border-claude-border">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 text-sm font-medium rounded-lg dark:text-claude-darkTextSecondary text-claude-textSecondary hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                {i18nService.t('workspaceDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default WorkspacePanel;
