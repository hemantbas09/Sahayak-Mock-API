import React from 'react';
import { 
  Plus, 
  Trash2, 
  Settings, 
  Globe, 
  Clock, 
  FileText,
  X
} from 'lucide-react';
import { MockEnvironment, KeyValue } from '../types';

interface EnvironmentSettingsProps {
  environment: MockEnvironment;
  onChangeEnvironment: (updated: MockEnvironment) => void;
  onClose: () => void;
}

export default function EnvironmentSettings({
  environment,
  onChangeEnvironment,
  onClose
}: EnvironmentSettingsProps) {

  // Global Headers CRUD
  const handleAddHeader = () => {
    const newHeader: KeyValue = {
      id: 'eh-' + Math.random().toString(36).substr(2, 9),
      key: '',
      value: ''
    };
    onChangeEnvironment({
      ...environment,
      headers: [...environment.headers, newHeader]
    });
  };

  const handleUpdateHeader = (id: string, key: 'key' | 'value', val: string) => {
    onChangeEnvironment({
      ...environment,
      headers: environment.headers.map(h => h.id === id ? { ...h, [key]: val } : h)
    });
  };

  const handleDeleteHeader = (id: string) => {
    onChangeEnvironment({
      ...environment,
      headers: environment.headers.filter(h => h.id !== id)
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/80 p-4 animate-fade-in select-none">
      <div className="w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-950">
          <div className="flex items-center gap-2.5">
            <Settings size={18} className="text-sky-400" />
            <div>
              <h2 className="text-sm font-bold text-gray-100 uppercase tracking-wide">Environment Settings</h2>
              <p className="text-[11px] text-gray-400">Configure globals for "{environment.name}"</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Section 1: General Settings */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-gray-800/60 pb-1.5">
              <Globe size={13} />
              <span>General Configurations</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400">Environment Name:</label>
                <input
                  type="text"
                  value={environment.name}
                  onChange={(e) => onChangeEnvironment({ ...environment, name: e.target.value })}
                  placeholder="e.g. My REST API Gateway"
                  className="bg-gray-950 border border-gray-800 hover:border-gray-700 text-gray-200 text-xs rounded px-3 py-2 outline-none focus:border-sky-500/50 transition-colors"
                />
              </div>

              {/* Endpoint Prefix */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400">Global URL Prefix:</label>
                <div className="flex bg-gray-950 border border-gray-800 hover:border-gray-700 rounded overflow-hidden focus-within:border-sky-500/50 transition-colors">
                  <span className="pl-3 py-2 text-xs text-gray-500 font-mono select-none">/</span>
                  <input
                    type="text"
                    value={environment.endpointPrefix}
                    onChange={(e) => onChangeEnvironment({ ...environment, endpointPrefix: e.target.value.replace(/^\/+/, '') })}
                    placeholder="e.g. api/v1"
                    className="w-full bg-transparent text-gray-200 font-mono text-xs py-2 px-1 outline-none"
                  />
                </div>
              </div>

              {/* Latency Fallback */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400">Default Global Latency (Delay):</label>
                <div className="flex items-center gap-2 bg-gray-950 border border-gray-800 hover:border-gray-700 px-3 py-2 rounded focus-within:border-sky-500/50 transition-colors">
                  <Clock size={14} className="text-gray-500" />
                  <input
                    type="number"
                    min="0"
                    value={environment.latency || 0}
                    onChange={(e) => onChangeEnvironment({ ...environment, latency: parseInt(e.target.value, 10) || 0 })}
                    placeholder="0"
                    className="w-full bg-transparent border-none outline-none text-xs text-gray-200 font-mono"
                  />
                  <span className="text-[10px] font-bold text-gray-500 select-none">ms</span>
                </div>
              </div>

              {/* Port (Informational) */}
              <div className="flex flex-col gap-1.5 opacity-60">
                <label className="text-xs font-semibold text-gray-400">Server Container Ingress Port:</label>
                <input
                  type="text"
                  value="3000 (Fixed by Sandbox Infrastructure)"
                  disabled
                  className="bg-gray-950/40 border border-gray-900 text-gray-500 text-xs rounded px-3 py-2 outline-none font-mono cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Global Common headers */}
          <div className="space-y-3.5">
            <div className="flex justify-between items-center border-b border-gray-800/60 pb-1.5">
              <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileText size={13} />
                <span>Global Common Headers ({environment.headers.length})</span>
              </h3>
              <button
                onClick={handleAddHeader}
                className="bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs px-2.5 py-1.5 rounded flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Plus size={13} />
                <span>Add Global Header</span>
              </button>
            </div>

            <p className="text-[11px] text-gray-500 leading-normal">
              These headers will be automatically appended to **every** mock response served by this environment. Individual route headers can override these.
            </p>

            {environment.headers.length === 0 ? (
              <div className="border border-dashed border-gray-800 rounded-lg p-6 text-center text-gray-500">
                <p className="text-xs font-semibold">No global headers defined</p>
                <p className="text-[10px] text-gray-600 mt-0.5">Click "Add Global Header" above to insert default headers like CORS.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                {environment.headers.map((header) => (
                  <div key={header.id} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={header.key}
                      placeholder="Header Name (e.g. Access-Control-Allow-Origin)"
                      onChange={(e) => handleUpdateHeader(header.id, 'key', e.target.value)}
                      className="flex-1 bg-gray-950 border border-gray-800 text-gray-200 text-xs rounded px-3 py-1.5 outline-none font-mono focus:border-sky-500/50 transition-colors"
                    />
                    <input
                      type="text"
                      value={header.value}
                      placeholder="Header Value (e.g. *)"
                      onChange={(e) => handleUpdateHeader(header.id, 'value', e.target.value)}
                      className="flex-1 bg-gray-950 border border-gray-800 text-gray-200 text-xs rounded px-3 py-1.5 outline-none font-mono focus:border-sky-500/50 transition-colors"
                    />
                    <button
                      onClick={() => handleDeleteHeader(header.id)}
                      className="p-1.5 hover:bg-gray-800 rounded text-rose-400 hover:text-rose-300 transition-colors shrink-0 cursor-pointer"
                      title="Delete Global Header"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-800 bg-gray-950 text-right">
          <button
            onClick={onClose}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs px-5 py-2 rounded-md transition-colors shadow-md hover:shadow-sky-500/10 cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
}
