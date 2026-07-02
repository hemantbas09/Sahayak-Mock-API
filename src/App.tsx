import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  Terminal, 
  Layers, 
  Settings, 
  Plus,
  RefreshCw,
  HelpCircle,
  Code,
  Trash2,
  Save,
  Undo2
} from 'lucide-react';
import { MockEnvironment, MockRoute, RouteResponse, RequestLog } from './types';
import Sidebar from './components/Sidebar';
import RouteEditor from './components/RouteEditor';
import EnvironmentSettings from './components/EnvironmentSettings';
import LogViewer from './components/LogViewer';

type MainTab = 'mocks' | 'logs';

export default function App() {
  // Environments list and selection state
  const [environments, setEnvironments] = useState<MockEnvironment[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // Active Main Navigation Tab
  const [activeTab, setActiveTab] = useState<MainTab>('mocks');

  // Logs list state
  const [logs, setLogs] = useState<RequestLog[]>([]);

  // Trigger loading details from log into tester
  const [testerTrigger, setTesterTrigger] = useState<any | null>(null);

  // Global settings modal state
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);

  // Tracks if there are unsaved local modifications
  const [hasChanges, setHasChanges] = useState(false);

  // Custom modal dialog states for iframe compatibility
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  } | null>(null);

  // App URLs (injected at runtime or fallback to origin)
  const [appUrl, setAppUrl] = useState('');

  // Server state fetching status
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // On Mount: Load configurations and logs from server once
  useEffect(() => {
    fetchEnvironments();
    fetchLogs();
  }, []);

  // Auto-poll logs and environments every 4 seconds to keep the small team perfectly in sync!
  useEffect(() => {
    const interval = setInterval(() => {
      // Prevent fetching environments when the user is actively typing/focusing an input,
      // or if they have unsaved local modifications. This avoids overwriting changes.
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.classList.contains('cm-content') || // support CodeMirror
        activeEl.getAttribute('contenteditable') === 'true'
      );
      
      if (!isTyping && !hasChanges) {
        fetchEnvironments(selectedEnvId);
      }
      fetchLogs();
    }, 4000);

    return () => clearInterval(interval);
  }, [selectedEnvId, hasChanges]);

  // Warn user if they try to leave or reload the page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  const fetchEnvironments = async (currentSelectedId?: string | null) => {
    try {
      const res = await fetch('/api/environments');
      if (res.ok) {
        const data = await res.json();
        setEnvironments(data);
        
        const activeId = currentSelectedId !== undefined ? currentSelectedId : selectedEnvId;
        if (data.length > 0 && !activeId) {
          setSelectedEnvId(data[0].id);
          if (data[0].routes.length > 0) {
            setSelectedRouteId(data[0].routes[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load environments:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  };

  // Update local Environments state and mark as unsaved
  const saveEnvironments = (updatedEnvs: MockEnvironment[]) => {
    setEnvironments(updatedEnvs);
    setHasChanges(true);
  };

  // Synchronize local Environments with backend server disk
  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/environments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(environments)
      });
      if (res.ok) {
        setHasChanges(false);
      } else {
        console.error('Failed to save environments to server:', res.statusText);
      }
    } catch (err) {
      console.error('Failed to save environments to server:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Revert all local changes by reloading from server
  const handleDiscardChanges = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Discard Unsaved Changes',
      message: 'Are you sure you want to discard all unsaved modifications? This will revert the mock configurations to their last saved state from the server.',
      onConfirm: () => {
        fetchEnvironments();
        setHasChanges(false);
        setConfirmModal(null);
      }
    });
  };

  const handleClearLogs = async () => {
    try {
      await fetch('/api/logs', { method: 'DELETE' });
      setLogs([]);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  // Active Object Getters
  const activeEnv = environments.find(e => e.id === selectedEnvId) || null;
  const activeRoute = activeEnv?.routes.find(r => r.id === selectedRouteId) || null;

  // Sidebar Callbacks
  const handleSelectEnv = (id: string) => {
    setSelectedEnvId(id);
    const env = environments.find(e => e.id === id);
    if (env && env.routes.length > 0) {
      setSelectedRouteId(env.routes[0].id);
    } else {
      setSelectedRouteId(null);
    }
  };

  const handleSelectRoute = (id: string | null) => {
    setSelectedRouteId(id);
  };

  const handleAddEnv = () => {
    const newId = 'env-' + Math.random().toString(36).substr(2, 9);
    const newEnv: MockEnvironment = {
      id: newId,
      name: `New Mock Server ${environments.length + 1}`,
      endpointPrefix: '',
      port: 3000,
      latency: 0,
      headers: [
        { id: 'h-' + Math.random().toString(36).substr(2, 5), key: 'Content-Type', value: 'application/json' },
        { id: 'h-' + Math.random().toString(36).substr(2, 5), key: 'Access-Control-Allow-Origin', value: '*' }
      ],
      routes: []
    };
    const updated = [...environments, newEnv];
    saveEnvironments(updated);
    setSelectedEnvId(newId);
    setSelectedRouteId(null);
  };

  const handleDeleteEnv = (id: string) => {
    const targetEnv = environments.find(e => e.id === id);
    const envName = targetEnv ? targetEnv.name : 'this environment';
    
    setConfirmModal({
      isOpen: true,
      title: 'Delete Environment',
      message: `Are you sure you want to delete "${envName}"? This will permanently delete all associated routes, rules, and mock responses.`,
      onConfirm: () => {
        setEnvironments(prevEnvs => {
          const updated = prevEnvs.filter(e => e.id !== id);
          
          setTimeout(() => {
            if (updated.length > 0) {
              setSelectedEnvId(updated[0].id);
              setSelectedRouteId(updated[0].routes[0]?.id || null);
            } else {
              setSelectedEnvId(null);
              setSelectedRouteId(null);
            }
          }, 0);
          
          return updated;
        });
        setHasChanges(true);
        setConfirmModal(null);
      }
    });
  };

  const handleDuplicateEnv = (env: MockEnvironment) => {
    const newId = 'env-' + Math.random().toString(36).substr(2, 9);
    const duplicated: MockEnvironment = {
      ...env,
      id: newId,
      name: `${env.name} (Copy)`
    };
    const updated = [...environments, duplicated];
    saveEnvironments(updated);
    setSelectedEnvId(newId);
    setSelectedRouteId(duplicated.routes[0]?.id || null);
  };

  const handleAddRoute = () => {
    if (!selectedEnvId) return;
    const newRouteId = 'route-' + Math.random().toString(36).substr(2, 9);
    const newResponseId = 'resp-' + Math.random().toString(36).substr(2, 9);
    
    const newRoute: MockRoute = {
      id: newRouteId,
      method: 'get',
      endpoint: `api/resource-${(activeEnv?.routes.length || 0) + 1}`,
      description: 'Standard JSON resource endpoint',
      latency: 0,
      responses: [
        {
          id: newResponseId,
          statusCode: 200,
          label: 'Success Response',
          headers: [],
          body: JSON.stringify({ message: "Hello! This is your newly created API endpoint." }, null, 2),
          rules: [],
          rulesOperator: 'AND'
        }
      ],
      selectedResponseId: newResponseId
    };

    const updated = environments.map(e => {
      if (e.id === selectedEnvId) {
        return {
          ...e,
          routes: [...e.routes, newRoute]
        };
      }
      return e;
    });

    saveEnvironments(updated);
    setSelectedRouteId(newRouteId);
  };

  const handleDeleteRoute = (id: string) => {
    if (!selectedEnvId) return;
    
    setEnvironments(prevEnvs => {
      const updated = prevEnvs.map(e => {
        if (e.id === selectedEnvId) {
          const routes = e.routes.filter(r => r.id !== id);
          return { ...e, routes };
        }
        return e;
      });

      // Auto-select another route if we deleted the currently selected one
      if (selectedRouteId === id) {
        const env = updated.find(e => e.id === selectedEnvId);
        setTimeout(() => {
          setSelectedRouteId(env?.routes[0]?.id || null);
        }, 0);
      }

      return updated;
    });
    setHasChanges(true);
  };

  const handleDuplicateRoute = (route: MockRoute) => {
    if (!selectedEnvId) return;
    const newRouteId = 'route-' + Math.random().toString(36).substr(2, 9);
    
    // Deep copy responses with new IDs
    const duplicatedResponses = route.responses.map((resp, idx) => {
      const respId = 'resp-' + idx + '-' + Math.random().toString(36).substr(2, 5);
      return {
        ...resp,
        id: respId,
        rules: (resp.rules || []).map((rule, ridx) => ({
          ...rule,
          id: 'rule-' + ridx + '-' + Math.random().toString(36).substr(2, 5)
        }))
      };
    });

    const duplicatedRoute: MockRoute = {
      ...route,
      id: newRouteId,
      endpoint: `${route.endpoint}-copy`,
      responses: duplicatedResponses,
      selectedResponseId: duplicatedResponses[0]?.id || ''
    };

    const updated = environments.map(e => {
      if (e.id === selectedEnvId) {
        return {
          ...e,
          routes: [...e.routes, duplicatedRoute]
        };
      }
      return e;
    });

    saveEnvironments(updated);
    setSelectedRouteId(newRouteId);
  };

  const handleReorderRoutes = (reorderedRoutes: MockRoute[]) => {
    if (!selectedEnvId) return;
    const updated = environments.map(e => {
      if (e.id === selectedEnvId) {
        return { ...e, routes: reorderedRoutes };
      }
      return e;
    });
    saveEnvironments(updated);
  };

  const handleImportEnvironments = (imported: MockEnvironment[]) => {
    // Generate fresh server IDs to avoid collisions
    const preppedImports = imported.map(env => ({
      ...env,
      id: 'env-' + Math.random().toString(36).substr(2, 9)
    }));
    
    const updated = [...environments, ...preppedImports];
    saveEnvironments(updated);
    
    // Select the first imported environment
    setSelectedEnvId(preppedImports[0].id);
    setSelectedRouteId(preppedImports[0].routes[0]?.id || null);
    
    setAlertModal({
      isOpen: true,
      title: 'Import Successful',
      message: `Successfully imported ${preppedImports.length} mock environment(s) into your workspaces!`
    });
  };

  // Settings Callback
  const handleUpdateEnvironment = (updatedEnv: MockEnvironment) => {
    const updated = environments.map(e => e.id === updatedEnv.id ? updatedEnv : e);
    saveEnvironments(updated);
  };

  // Route Editor Callbacks
  const handleUpdateRoute = (updatedRoute: MockRoute) => {
    if (!selectedEnvId) return;
    const updated = environments.map(e => {
      if (e.id === selectedEnvId) {
        return {
          ...e,
          routes: e.routes.map(r => r.id === updatedRoute.id ? updatedRoute : r)
        };
      }
      return e;
    });
    saveEnvironments(updated);
  };

  const handleShowAlert = (title: string, message: string) => {
    setAlertModal({
      isOpen: true,
      title,
      message
    });
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden font-sans">
      
      {/* Top Navigation / App Banner */}
      <div className="bg-gray-950 border-b border-gray-800 px-4 py-3 shrink-0 flex flex-wrap items-center justify-between gap-4 select-none">
        <div className="flex items-center gap-3">
          {/* Logo badge */}
          <div className="bg-sky-600 p-1.5 rounded-lg text-white font-black leading-none flex items-center justify-center shadow-lg shadow-sky-600/10">
            <Layers size={18} />
          </div>
          <div>
            <h1 className="text-sm font-extrabold tracking-tight text-white flex items-center gap-1.5">
              <span>API MOCK SERVER</span>
              <span className="text-[10px] bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded-full text-gray-400 font-bold tracking-normal leading-none uppercase">v1.0 CLONE</span>
            </h1>
            <p className="text-[10px] text-gray-500 font-medium">Testing & serving dynamic REST endpoints locally</p>
          </div>
        </div>

        {/* Global Nav Tabs */}
        <div className="flex bg-gray-900/60 border border-gray-800 p-1 rounded-lg">
          <button
            onClick={() => { setActiveTab('mocks'); setTesterTrigger(null); }}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              activeTab === 'mocks' ? 'bg-sky-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Mocks Designer
          </button>
          <button
            onClick={() => { setActiveTab('logs'); setTesterTrigger(null); }}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'logs' ? 'bg-sky-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Terminal size={12} />
            <span>Server Logs</span>
            {logs.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            )}
          </button>
        </div>

        {/* Sync / Save Controls */}
        <div className="flex items-center gap-3">
          {hasChanges ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide uppercase select-none animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                <span>Unsaved Changes</span>
              </div>
              
              <button
                onClick={handleDiscardChanges}
                className="px-2.5 py-1 text-xs font-semibold text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 rounded-md transition-all cursor-pointer flex items-center gap-1"
                title="Revert all unsaved edits"
              >
                <Undo2 size={12} />
                <span>Discard</span>
              </button>

              <button
                onClick={handleSaveChanges}
                disabled={isSaving}
                className="px-3 py-1 text-xs font-bold text-white bg-sky-650 hover:bg-sky-500 border border-sky-600 rounded-md transition-all cursor-pointer shadow-lg shadow-sky-600/15 flex items-center gap-1.5"
              >
                {isSaving ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save size={12} />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-mono text-gray-500">
              {isSaving ? (
                <div className="flex items-center gap-1.5 text-sky-400">
                  <RefreshCw size={12} className="animate-spin" />
                  <span>Saving...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-emerald-500 bg-emerald-500/5 border border-emerald-500/10 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide uppercase select-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span>Synced</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex min-h-0">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
            <div className="w-8 h-8 border-3 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-semibold">Bootstrapping local environments config...</p>
          </div>
        ) : (
          <>
            {/* Nav Panels conditional rendering */}
            {activeTab === 'mocks' && (
              <div className="flex-1 flex min-h-0">
                {/* Left Route sidebar */}
                <Sidebar
                  environments={environments}
                  selectedEnvId={selectedEnvId}
                  selectedRouteId={selectedRouteId}
                  onSelectEnv={handleSelectEnv}
                  onSelectRoute={handleSelectRoute}
                  onAddEnv={handleAddEnv}
                  onDeleteEnv={handleDeleteEnv}
                  onDuplicateEnv={handleDuplicateEnv}
                  onAddRoute={handleAddRoute}
                  onDeleteRoute={handleDeleteRoute}
                  onDuplicateRoute={handleDuplicateRoute}
                  onReorderRoutes={handleReorderRoutes}
                  onImportEnvironments={handleImportEnvironments}
                  onOpenGlobalSettings={() => setIsGlobalSettingsOpen(true)}
                  onShowAlert={handleShowAlert}
                />

                {/* Central active route config panels */}
                <div className="flex-1 flex flex-col min-h-0">
                  {activeRoute && selectedEnvId ? (
                    <RouteEditor
                      route={activeRoute}
                      envId={selectedEnvId}
                      envName={activeEnv?.name || ''}
                      appUrl={appUrl}
                      onChangeRoute={handleUpdateRoute}
                      onShowAlert={handleShowAlert}
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-center p-6 gap-3 select-none">
                      <Code size={40} className="text-gray-800" />
                      <div>
                        <p className="text-sm font-bold text-gray-400">No Endpoint Selected</p>
                        <p className="text-xs text-gray-600 mt-1 max-w-sm leading-relaxed">
                          Select a route from the sidebar, or create a new one using the <strong className="text-sky-500/80">Add</strong> button to get started!
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'logs' && (
              <LogViewer
                logs={logs}
                onClearLogs={handleClearLogs}
                onRefreshLogs={fetchLogs}
              />
            )}
          </>
        )}
      </div>

      {/* Global Environment Settings Modal popup */}
      {isGlobalSettingsOpen && activeEnv && (
        <EnvironmentSettings
          environment={activeEnv}
          onChangeEnvironment={handleUpdateEnvironment}
          onClose={() => setIsGlobalSettingsOpen(false)}
        />
      )}

      {/* Custom Confirmation Modal */}
      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/80 p-4 animate-fade-in">
          <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden flex flex-col p-5 gap-4">
            <div className="flex items-start gap-3">
              <div className="bg-rose-500/10 p-2 rounded-lg text-rose-400 shrink-0">
                <Trash2 size={20} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-gray-100 uppercase tracking-wide">{confirmModal.title}</h3>
                <p className="text-xs text-gray-400 mt-1.5 leading-normal">{confirmModal.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5 mt-2">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-gray-950 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 text-gray-300 text-xs font-semibold rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded transition-colors shadow-lg shadow-rose-600/15 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Alert Modal */}
      {alertModal && alertModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/80 p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden flex flex-col p-5 gap-4">
            <div className="flex items-start gap-3">
              <div className="bg-sky-500/10 p-2 rounded-lg text-sky-400 shrink-0">
                <HelpCircle size={20} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-gray-100 uppercase tracking-wide">{alertModal.title}</h3>
                <p className="text-xs text-gray-400 mt-1.5 leading-normal">{alertModal.message}</p>
              </div>
            </div>
            <div className="flex justify-end mt-2">
              <button
                onClick={() => setAlertModal(null)}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded transition-colors cursor-pointer"
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
