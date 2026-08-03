'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Warning,
  DownloadSimpleIcon,
  CopySimpleIcon,
  CaretDownIcon,
  FilePdfIcon,
  FileTextIcon,
  SpinnerGapIcon,
} from '@phosphor-icons/react';
import { applyTheme, getStoredThemePrefs } from '@/lib/themes';
import { useProfile } from '@/hooks/useProfile';
import Navbar from '@/components/ui/Navbar';
import { hasPlaceholders } from '@/lib/inline';
import FeedbackModal from '@/components/ui/FeedbackModal';
import AvatarDropdown from '@/components/ui/AvatarDropdown';
import { getClientAuthProvider } from '@/lib/db/client';
import { useRouter } from 'next/navigation';

interface ToolbarProps {
  lastSaved: Date | null;
  resumeTitle?: string;
  onTitleChange?: (title: string) => void;
  resumeId?: string;
  rawContent?: string;
  onCloneAndTailor?: () => void;
  templateId?: string;
  onTemplateChange?: (id: string) => void;
}

export default function Toolbar({
  lastSaved,
  resumeTitle,
  onTitleChange,
  resumeId,
  rawContent,
  onCloneAndTailor,
}: ToolbarProps) {
  const [isDark, setIsDark] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showPlaceholderWarning, setShowPlaceholderWarning] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const { user, profile } = useProfile();
  const router = useRouter();
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { themeId, mode } = getStoredThemePrefs();
    applyTheme(themeId, mode);
    setIsDark(mode === 'dark');
  }, []);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(e.target as Node)
      ) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const toggleTheme = () => {
    const newMode = isDark ? 'light' : 'dark';
    const { themeId } = getStoredThemePrefs();
    applyTheme(themeId, newMode);
    setIsDark(!isDark);
  };

  const doExport = async () => {
    if (!resumeId || isExporting) return;
    setIsExporting(true);
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeId }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? 'resume.pdf';
      a.click();
      URL.revokeObjectURL(url);
      if (!localStorage.getItem('resmd_exported_once')) {
        localStorage.setItem('resmd_exported_once', '1');
        setTimeout(() => setShowFeedback(true), 800);
      }
    } catch {
      // Silently fail
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = () => {
    setShowExportMenu(false);
    if (!resumeId || isExporting) return;
    if (rawContent && hasPlaceholders(rawContent)) {
      setShowPlaceholderWarning(true);
    } else {
      doExport();
    }
  };

  const handleDownloadMd = () => {
    setShowExportMenu(false);
    if (!rawContent) return;
    const blob = new Blob([rawContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle =
      (resumeTitle ?? 'resume').replace(/[^a-z0-9\-_ ]/gi, '').trim() ||
      'resume';
    a.download = `${safeTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignOut = async () => {
    await getClientAuthProvider().signOut();
    router.push('/auth');
  };

  const lastSavedLabel = lastSaved ? formatRelative(lastSaved) : null;
  const email = profile?.email ?? user?.email ?? '';
  const canExport = !!rawContent || !!resumeId;

  return (
    <>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      {showPlaceholderWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-xl border border-border shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <Warning
                size={22}
                className="text-red-500 flex-shrink-0 mt-0.5"
              />
              <div>
                <h2 className="text-base font-semibold text-text mb-1">
                  Unfilled placeholders detected
                </h2>
                <p className="text-sm text-muted">
                  Your resume contains{' '}
                  <span className="text-red-500 font-medium">
                    [bracketed placeholders]
                  </span>{' '}
                  that may be AI suggestions. These will appear in the exported
                  PDF.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                onClick={() => setShowPlaceholderWarning(false)}
              >
                Fix first
              </Button>
              <Button
                onClick={() => {
                  setShowPlaceholderWarning(false);
                  doExport();
                }}
              >
                Export anyway
              </Button>
            </div>
          </div>
        </div>
      )}
      <Navbar
        left={
          resumeTitle !== undefined && onTitleChange ? (
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border rounded-lg cursor-text hover:border-accent/40 transition-colors duration-150 min-w-0"
                onClick={(e) => {
                  const input = (e.currentTarget as HTMLElement).querySelector(
                    'input'
                  );
                  input?.focus();
                }}
              >
                <div className="relative inline-flex items-center min-w-[3rem] max-w-[200px]">
                  <span
                    aria-hidden
                    className="invisible whitespace-pre text-sm font-semibold pointer-events-none select-none"
                  >
                    {resumeTitle || 'Untitled'}
                  </span>
                  <input
                    value={resumeTitle}
                    onChange={(e) => onTitleChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    className="absolute inset-0 w-full bg-transparent text-sm font-semibold text-text outline-none placeholder:text-faint"
                    placeholder="Untitled"
                    title="Click to rename"
                  />
                </div>
              </div>

              {onCloneAndTailor && resumeId && (
                <button
                  onClick={onCloneAndTailor}
                  title="Clone this variant"
                  className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2 transition-colors duration-150 flex-shrink-0"
                >
                  <CopySimpleIcon size={15} />
                </button>
              )}
            </div>
          ) : undefined
        }
        right={
          <div className="flex items-center gap-2">
            {lastSavedLabel && (
              <span className="text-xs text-muted hidden sm:block">
                {lastSavedLabel}
              </span>
            )}

            {/* Export dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu((v) => !v)}
                disabled={!canExport || isExporting}
                title="Export"
                className={`text-sm px-3 py-1.5 rounded-lg border border-border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex items-center gap-1.5 ${
                  !canExport || isExporting
                    ? 'text-faint cursor-not-allowed opacity-50'
                    : 'text-text hover:bg-surface-2'
                }`}
              >
                {isExporting ? (
                  <SpinnerGapIcon size={15} className="animate-spin" />
                ) : (
                  <DownloadSimpleIcon size={15} weight="bold" />
                )}
                <span className="hidden sm:inline">
                  {isExporting ? 'Exporting…' : 'Export'}
                </span>
                <CaretDownIcon size={12} className="hidden sm:block" />
              </button>

              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                  <button
                    onClick={handleExportPDF}
                    disabled={!resumeId}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors ${
                      !resumeId
                        ? 'text-faint cursor-not-allowed'
                        : 'text-text hover:bg-surface-2'
                    }`}
                  >
                    <FilePdfIcon
                      size={16}
                      className="text-muted flex-shrink-0"
                    />
                    <span>Export PDF</span>
                  </button>
                  <button
                    onClick={handleDownloadMd}
                    disabled={!rawContent}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors ${
                      !rawContent
                        ? 'text-faint cursor-not-allowed'
                        : 'text-text hover:bg-surface-2'
                    }`}
                  >
                    <FileTextIcon
                      size={16}
                      className="text-muted flex-shrink-0"
                    />
                    <span>Download .md</span>
                  </button>
                </div>
              )}
            </div>

            <AvatarDropdown
              email={email}
              isDark={isDark}
              onToggleTheme={toggleTheme}
              onShowFeedback={() => setShowFeedback(true)}
              onSignOut={handleSignOut}
            />
          </div>
        }
      />
    </>
  );
}

function formatRelative(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 10) return 'Saved just now';
  if (diff < 60) return `Saved ${diff}s ago`;
  if (diff < 3600) return `Saved ${Math.floor(diff / 60)}m ago`;
  return `Saved ${Math.floor(diff / 3600)}h ago`;
}
