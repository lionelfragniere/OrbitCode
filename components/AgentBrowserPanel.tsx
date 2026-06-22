'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Globe, Play, Camera,
  Loader2, Eye, Image as ImageIcon,
  MousePointer, Type, Navigation, Clock, RefreshCw, FileText
} from 'lucide-react';
import type { BrowserSessionState, BrowserStep } from '@/lib/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AgentBrowserPanelProps {
  // If provided, we watch live test stream
  liveSessionState?: BrowserSessionState | null;
  liveBrowserSteps?: BrowserStep[];
  
  // If runId provided instead of live stream, we fetch from historical execution
  runId?: string;
  projectFolder: string;
}

interface HistoricalRunData {
  id: string;
  manifest: BrowserSessionState;
  report: string | null;
  screenshots: string[];
  rawLogs: string;
  videoUrl?: string;
}

function getActionIcon(action: string) {
  switch (action) {
    case 'navigate': return <Navigation size={12} style={{ color: '#4EC3E0' }} />;
    case 'click':    return <MousePointer size={12} style={{ color: '#E85C0E' }} />;
    case 'type':     return <Type size={12} style={{ color: '#7C3AED' }} />;
    case 'wait':     return <Clock size={12} style={{ color: '#FFCB38' }} />;
    case 'screenshot': return <Camera size={12} style={{ color: '#10B981' }} />;
    case 'scroll':   return <RefreshCw size={12} style={{ color: '#3B82F6' }} />;
    default:         return <Eye size={12} style={{ color: 'var(--text-disabled)' }} />;
  }
}

export default function AgentBrowserPanel({
  liveSessionState,
  liveBrowserSteps = [],
  runId,
  projectFolder
}: AgentBrowserPanelProps) {
  const [activeMainTab, setActiveMainTab] = useState<'screenshot' | 'report' | 'recording'>('screenshot');
  const [activeSideTab, setActiveSideTab] = useState<'timeline' | 'logs'>('timeline');
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<HistoricalRunData | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const stepsRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  const isLive = !runId || (liveSessionState && liveSessionState.sessionId === runId);

  // Fetch history if not live
  useEffect(() => {
    if (!isLive && runId) {
      setLoadingHistory(true);
      fetch(`/api/runs?projectFolder=${encodeURIComponent(projectFolder)}&runId=${encodeURIComponent(runId)}`)
        .then(r => r.json())
        .then(d => {
          if (!d.error) {
            setHistoryData(d);
            if (d.screenshots && d.screenshots.length > 0) {
              setSelectedScreenshot(d.screenshots[0]);
            }
          }
          setLoadingHistory(false);
        })
        .catch(() => setLoadingHistory(false));
    }
  }, [runId, isLive, projectFolder]);

  // Derived state depending on Live vs Historical
  const status = isLive ? (liveSessionState?.status || 'idle') : (historyData?.manifest?.status || 'complete');
  const currentUrl = isLive 
    ? (liveSessionState?.currentUrl || liveBrowserSteps[liveBrowserSteps.length - 1]?.url || 'about:blank')
    : (historyData?.manifest?.currentUrl || 'about:blank');
  
  const browserSteps = isLive ? liveBrowserSteps : (historyData?.manifest?.steps || []);
  const allScreenshots = isLive 
    ? Array.from(new Set([...browserSteps.map(s => s.screenshot).filter(Boolean), ...(liveSessionState?.screenshots || [])]))
    : (historyData?.screenshots || []);

  const logs = isLive ? (liveSessionState?.logs || []) : (historyData?.rawLogs?.split('\n') || []);

  // Auto-scroll logic
  useEffect(() => { if (stepsRef.current) stepsRef.current.scrollTop = stepsRef.current.scrollHeight; }, [browserSteps.length]);
  useEffect(() => { if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight; }, [logs.length]);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* ── LEFT SIDEBAR: Timeline & Logs ── */}
      <div style={{
        width: '320px', display: 'flex', flexDirection: 'column',
        borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
          <button onClick={() => setActiveSideTab('timeline')} style={{
            flex: 1, padding: '10px', background: activeSideTab === 'timeline' ? 'var(--bg-primary)' : 'transparent',
            border: 'none', borderBottom: activeSideTab === 'timeline' ? '2px solid #4EC3E0' : '2px solid transparent',
            color: activeSideTab === 'timeline' ? '#4EC3E0' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px', fontWeight: 600
          }}>TIMELINE</button>
          <button onClick={() => setActiveSideTab('logs')} style={{
            flex: 1, padding: '10px', background: activeSideTab === 'logs' ? 'var(--bg-primary)' : 'transparent',
            border: 'none', borderBottom: activeSideTab === 'logs' ? '2px solid #FFCB38' : '2px solid transparent',
            color: activeSideTab === 'logs' ? '#FFCB38' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px', fontWeight: 600
          }}>LOGS</button>
        </div>
        
        {/* SIDEBAR CONTENT */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeSideTab === 'timeline' && (
            <div ref={stepsRef} style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
               {isLive && browserSteps.length === 0 && <div style={{ fontSize: '11px', color: 'var(--text-disabled)', textAlign: 'center', padding: '24px' }}>Waiting for browser...</div>}
               {!isLive && browserSteps.length === 0 && <div style={{ fontSize: '11px', color: 'var(--text-disabled)', textAlign: 'center', padding: '24px' }}>Detailed step timeline is not available for this run.</div>}
               {browserSteps.map((step, idx) => (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px', margin: '8px 0'
                  }}>
                    <div style={{ marginTop: '3px' }}>{getActionIcon(step.action)}</div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>{step.action}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)'}}>{step.description}</div>
                      {step.screenshot && (
                        <div style={{ fontSize: '10px', color: '#10B981', display: 'flex', alignItems: 'center', gap: '4px', marginTop:'4px', cursor: 'pointer' }} onClick={() => {
                          setActiveMainTab('screenshot');
                          setSelectedScreenshot(step.screenshot || null);
                        }}>
                          <Camera size={10} /> View Capture
                        </div>
                      )}
                    </div>
                  </div>
               ))}
            </div>
          )}

          {activeSideTab === 'logs' && (
             <div ref={logsRef} style={{ flex: 1, overflow: 'auto', padding: '12px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
               {logs.length === 0 ? <div style={{ color: 'var(--text-disabled)', textAlign: 'center', padding: '24px' }}>Logs unavailable</div> : logs.map((log, i) => (
                 <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid var(--border-subtle)', color: log.toLowerCase().includes('error') ? 'var(--color-error)' : 'var(--text-primary)' }}>
                   {log}
                 </div>
               ))}
             </div>
          )}
        </div>
      </div>

      {/* ── MAIN WORKSPACE ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Context bar */}
        <div style={{ padding: '12px 16px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '12px' }}>
           <div style={{ background: status === 'running' ? '#4EC3E022' : status === 'complete' ? '#10B98122' : '#FFCB3822', borderRadius: '50%', padding: '8px' }}>
              <Globe size={18} style={{ color: status === 'running' ? '#4EC3E0' : status === 'complete' ? '#10B981' : '#FFCB38' }} />
           </div>
           <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>
                {isLive ? 'Live Validation Session' : `Historical Run: ${runId}`}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Navigation size={10}/> {currentUrl}
              </div>
           </div>
        </div>

        {/* Tab Selection */}
        <div style={{ display: 'flex', padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)', gap: '16px' }}>
          {(['screenshot', 'recording', 'report'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveMainTab(tab)} style={{
              background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
              color: activeMainTab === tab ? 'var(--text-primary)' : 'var(--text-disabled)',
              fontWeight: activeMainTab === tab ? 700 : 500, fontSize: '12px', padding: '6px 12px', borderRadius: '4px',
              backgroundColor: activeMainTab === tab ? 'var(--bg-secondary)' : 'transparent'
            }}>
              {tab === 'screenshot' ? <ImageIcon size={14}/> : tab === 'recording' ? <Play size={14} /> : <FileText size={14}/>}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Workspace Area */}
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-tertiary)', position: 'relative' }}>
          
          {loadingHistory && (
             <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <Loader2 className="spin" size={32} style={{ color: 'var(--text-disabled)' }} />
             </div>
          )}



          {activeMainTab === 'screenshot' && (() => {
            const activeImage = selectedScreenshot || allScreenshots[0];
            const matchingStep = browserSteps.find(s => s.screenshot === activeImage);
            return (
              <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
                {/* Thumbnails rail */}
                <div style={{ width: '220px', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '12px', gap: '12px', flexShrink: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Captured Evidence ({allScreenshots.length})</div>
                  {allScreenshots.map((s, i) => (
                    <div 
                      key={i} 
                      onClick={() => setSelectedScreenshot(s as string)} 
                      style={{ 
                        cursor: 'pointer', overflow: 'hidden', borderRadius: '6px', 
                        border: activeImage === s ? '2px solid #4EC3E0' : '1px solid var(--border-subtle)',
                        boxShadow: activeImage === s ? '0 0 10px rgba(78, 195, 224, 0.2)' : 'none',
                        transition: 'all 0.2s', opacity: activeImage === s ? 1 : 0.7,
                        background: 'var(--bg-tertiary)' 
                      }}
                    >
                      {failedImages.has(s as string) ? (
                        <div style={{ width: '100%', aspectRatio: '16/10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-error)', padding: '8px', textAlign: 'center', fontSize: '9px', wordBreak: 'break-all' }}>
                          Broken Image<br/>{(s as string).split('/').pop()}
                        </div>
                      ) : (
                        <img src={s as string} onError={() => setFailedImages(prev => new Set(prev).add(s as string))} style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
                      )}
                      <div style={{ padding: '6px', fontSize: '10px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', textAlign: 'center' }}>Screenshot {i + 1}</div>
                    </div>
                  ))}
                  {allScreenshots.length === 0 && <div style={{ color: 'var(--text-disabled)', fontSize: '11px', textAlign: 'center', marginTop: '20px' }}>No screenshots captured.</div>}
                </div>
                
                {/* Main image pane */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                  {activeImage && matchingStep && (
                    <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', display: 'flex', gap: '24px', flexShrink: 0 }}>
                      <div>
                        <div style={{ fontSize: '10px', color: 'var(--text-disabled)', textTransform: 'uppercase', marginBottom: '2px' }}>Action</div>
                        <div style={{ fontSize: '12px', fontWeight: 500 }}>{matchingStep.action}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-disabled)', textTransform: 'uppercase', marginBottom: '2px' }}>URL</div>
                        <div style={{ fontSize: '12px', fontWeight: 500, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{matchingStep.url || 'about:blank'}</div>
                      </div>
                      <div>
                         <div style={{ fontSize: '10px', color: 'var(--text-disabled)', textTransform: 'uppercase', marginBottom: '2px' }}>Description</div>
                         <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{matchingStep.description}</div>
                      </div>
                    </div>
                  )}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', overflow: 'hidden' }}>
                    {activeImage ? (
                      failedImages.has(activeImage as string) ? (
                        <div style={{ textAlign: 'center', padding: '40px', background: 'var(--bg-primary)', border: '1px dashed var(--color-error)', borderRadius: '8px', maxWidth: '600px', width: '100%' }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-error)', marginBottom: '16px' }}>Image Load Failed</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>The screenshot file is either missing, corrupted, or inaccessible.</div>
                          <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', background: 'var(--bg-secondary)', padding: '8px', borderRadius: '4px', color: 'var(--text-disabled)', wordBreak: 'break-all' }}>Path: {activeImage}</div>
                        </div>
                      ) : (
                        <img src={activeImage as string} onError={() => setFailedImages(prev => new Set(prev).add(activeImage as string))} alt="Selected Capture" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', border: '1px solid var(--border-subtle)' }} />
                      )
                    ) : (
                      <div style={{ color: 'var(--text-disabled)', textAlign: 'center' }}>Select a screenshot to view details</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {activeMainTab === 'recording' && (() => {
            const posterUrl = allScreenshots.length > 0 ? (allScreenshots[0] as string) : undefined;
            return (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>Browser Recording Playback</div>
                  {historyData?.videoUrl && <div style={{ fontSize: '10px', background: 'rgba(78, 195, 224, 0.1)', color: '#4EC3E0', padding: '4px 8px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>AVAILABLE</div>}
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                  {historyData && historyData.videoUrl ? (
                     <video src={historyData.videoUrl} poster={posterUrl} controls style={{ width: '100%', maxWidth: '900px', borderRadius: '8px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', border: '1px solid var(--border-subtle)', background: '#000' }} />
                  ) : isLive ? (
                     <div style={{ textAlign: 'center', padding: '40px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-subtle)', maxWidth: '400px' }}>
                       <div style={{ marginBottom: '16px', color: '#4EC3E0' }}><Play size={32} /></div>
                       <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Recording Processing</div>
                       <div style={{ fontSize: '12px', color: 'var(--text-disabled)', lineHeight: '1.5' }}>Playwright is capturing the browser viewport.<br/>The video will be available to stream once the run completes.</div>
                     </div>
                  ) : (
                     <div style={{ textAlign: 'center', padding: '40px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-subtle)', maxWidth: '400px' }}>
                       <div style={{ marginBottom: '16px', color: 'var(--text-disabled)' }}><Play size={32} /></div>
                       <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Recording Unavailable</div>
                       <div style={{ fontSize: '12px', color: 'var(--text-disabled)', lineHeight: '1.5' }}>No browser recording was found for this run.<br/>Visual validation failed or recording was disabled.</div>
                     </div>
                  )}
                </div>
              </div>
            );
          })()}

          {activeMainTab === 'report' && (
            <div style={{ padding: '32px 48px', maxWidth: '1200px', margin: '0 auto', background: 'var(--bg-primary)', minHeight: '100%', borderLeft: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)' }}>
              {historyData && historyData.report ? (
                <div className="report-markdown" style={{ fontSize: '14px', lineHeight: '1.7' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {historyData.report}
                  </ReactMarkdown>
                </div>
              ) : (
                <div style={{ color: 'var(--text-disabled)', textAlign: 'center', marginTop: '40px' }}>
                   No diagnostic report available for this run.
                </div>
              )}
            </div>
          )}

        </div>
      </div>


    </div>
  );
}
