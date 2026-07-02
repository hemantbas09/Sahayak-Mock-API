import React, { useState } from 'react';
import { 
  Play, 
  Trash2, 
  RefreshCw, 
  Search, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  Database,
  ArrowRight,
  Terminal,
  FileCode2,
  ListFilter
} from 'lucide-react';
import { RequestLog } from '../types';

interface LogViewerProps {
  logs: RequestLog[];
  onClearLogs: () => void;
  onRefreshLogs: () => void;
}

export default function LogViewer({
  logs,
  onClearLogs,
  onRefreshLogs
}: LogViewerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [filterMethod, setFilterMethod] = useState<string>('ALL');

  // Parse and try to format JSON strings nicely
  const formatPayload = (val: any): string => {
    if (!val) return 'Empty';
    if (typeof val === 'object') {
      return JSON.stringify(val, null, 2);
    }
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(val);
    }
  };

  // Filter logs
  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.url.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          log.matchedRoute.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMethod = filterMethod === 'ALL' || log.method.toUpperCase() === filterMethod;
    return matchesSearch && matchesMethod;
  });

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (status >= 300 && status < 400) return 'text-sky-400 bg-sky-500/10 border-sky-500/20';
    if (status >= 400 && status < 500) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
  };

  const getMethodColor = (method: string) => {
    const m = method.toLowerCase();
    if (m === 'get') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/10';
    if (m === 'post') return 'text-sky-400 bg-sky-500/10 border-sky-500/10';
    if (m === 'put') return 'text-amber-400 bg-amber-500/10 border-amber-500/10';
    if (m === 'delete') return 'text-rose-400 bg-rose-500/10 border-rose-500/10';
    return 'text-purple-400 bg-purple-500/10 border-purple-500/10';
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950 text-gray-300">
      
      {/* Search & Actions Bar */}
      <div className="p-4 border-b border-gray-800 bg-gray-950 flex flex-wrap items-center justify-between gap-3 shrink-0 select-none">
        <div className="flex items-center gap-2.5">
          <Terminal size={18} className="text-sky-400" />
          <h2 className="text-sm font-bold text-gray-100 uppercase tracking-wider">Live Mock Server Logs</h2>
          <span className="text-xs bg-gray-900 border border-gray-800 px-2 py-0.5 rounded text-gray-400">
            {filteredLogs.length} entries
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Refresh */}
          <button
            onClick={onRefreshLogs}
            className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-sky-400 transition-all cursor-pointer flex items-center gap-1.5 border border-gray-800/60 text-xs font-semibold"
            title="Refresh Logs"
          >
            <RefreshCw size={14} className="animate-hover-spin" />
            <span>Refresh</span>
          </button>

          {/* Clear Logs */}
          <button
            onClick={onClearLogs}
            disabled={logs.length === 0}
            className="p-2 bg-gray-900 hover:bg-rose-950/20 disabled:bg-gray-950 border border-gray-800 text-rose-400 hover:text-rose-300 disabled:text-gray-600 rounded-lg transition-all text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            title="Clear Log History"
          >
            <Trash2 size={14} />
            <span>Clear Logs</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Input Bar */}
      <div className="px-4 py-2 border-b border-gray-800 bg-gray-950/40 flex flex-wrap items-center gap-3 shrink-0 select-none">
        {/* Search Input */}
        <div className="flex-1 min-w-[200px] flex items-center bg-gray-900 border border-gray-800 hover:border-gray-700 focus-within:border-sky-500/50 rounded px-2.5 py-1.5 transition-colors">
          <Search size={14} className="text-gray-500 mr-2 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by requested URL path or matched route..."
            className="w-full bg-transparent text-xs text-gray-200 outline-none placeholder:text-gray-600"
          />
        </div>

        {/* Method filter dropdown */}
        <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 text-xs text-gray-400">
          <ListFilter size={14} />
          <span>Method:</span>
          <select
            value={filterMethod}
            onChange={(e) => setFilterMethod(e.target.value)}
            className="bg-transparent text-gray-200 font-semibold outline-none cursor-pointer"
          >
            <option value="ALL">ALL</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
          </select>
        </div>
      </div>

      {/* Logs Table / List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-gray-500 max-w-md mx-auto mt-8 border border-dashed border-gray-800 rounded-xl">
            <Database size={32} className="mx-auto mb-3 text-gray-700" />
            <p className="text-sm font-bold text-gray-400">No mock server logs found</p>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              When external clients or the built-in tester trigger requests matching your mock environment paths (`/mock/:envId/*`), they will appear here in real-time.
            </p>
            <button
              onClick={onRefreshLogs}
              className="mt-4 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              Check Again
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-900">
            {filteredLogs.map((log) => {
              const isExpanded = selectedLogId === log.id;
              const hasQuery = Object.keys(log.queryParams || {}).length > 0;
              const hasBody = log.body && (typeof log.body === 'object' ? Object.keys(log.body).length > 0 : log.body.length > 0);

              return (
                <div key={log.id} className="bg-gray-950/20 hover:bg-gray-900/10 transition-colors">
                  {/* Primary Row */}
                  <div
                    onClick={() => setSelectedLogId(isExpanded ? null : log.id)}
                    className="p-3.5 flex items-center justify-between gap-4 cursor-pointer select-none text-xs"
                  >
                    <div className="flex items-center gap-3 overflow-hidden flex-1">
                      {/* Expansion chevron */}
                      <div className="text-gray-500">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>

                      {/* Timestamp */}
                      <span className="text-[10px] text-gray-500 font-mono shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>

                      {/* Method Badge */}
                      <span className={`text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded leading-none border shrink-0 ${getMethodColor(log.method)}`}>
                        {log.method}
                      </span>

                      {/* Request URL path */}
                      <span className="font-mono truncate text-gray-200 font-medium tracking-tight">
                        {log.url}
                      </span>
                    </div>

                    {/* Status & delay badge */}
                    <div className="flex items-center gap-2.5 shrink-0">
                      {/* Latency applied */}
                      <div className="flex items-center gap-1 text-[10px] text-gray-500 font-mono">
                        <Clock size={12} />
                        <span>{log.latency}ms</span>
                      </div>

                      {/* Returned status code */}
                      <span className={`px-2 py-0.5 rounded-full font-bold tracking-wide border leading-normal ${getStatusColor(log.responseStatus)}`}>
                        {log.responseStatus}
                      </span>
                    </div>
                  </div>

                  {/* Expanded Inspector Panel */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-1.5 border-t border-gray-900 bg-gray-950/50 space-y-4 animate-fade-in text-xs">
                      
                      {/* Warning Box */}
                      {log.warning && (
                        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 p-3 rounded-lg text-[11px] leading-relaxed flex items-start gap-2">
                          <span className="font-bold select-none text-amber-500">⚠ Warning:</span>
                          <span>{log.warning}</span>
                        </div>
                      )}

                      {/* Diagnostics header */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-900/60 p-3 rounded-lg border border-gray-800 text-[11px] text-gray-400">
                        <div>
                          <strong>Client IP:</strong> <span className="font-mono text-gray-300">{log.ip}</span>
                        </div>
                        <div>
                          <strong>Matched Mock:</strong> <span className="font-mono text-sky-400">{log.matchedRoute}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Request section */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide border-b border-gray-800 pb-1 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                            <span>Incoming Request Payload</span>
                          </h4>

                          {/* Query params if present */}
                          {hasQuery && (
                            <div className="space-y-1 bg-gray-900/40 p-2.5 rounded border border-gray-800">
                              <span className="text-[10px] uppercase font-bold text-gray-500 font-mono">Query Parameters</span>
                              <pre className="text-[10px] font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                                {formatPayload(log.queryParams)}
                              </pre>
                            </div>
                          )}

                          {/* Headers */}
                          <div className="space-y-1 bg-gray-900/40 p-2.5 rounded border border-gray-800">
                            <span className="text-[10px] uppercase font-bold text-gray-500 font-mono">Request Headers</span>
                            <div className="max-h-[150px] overflow-y-auto text-[10px] font-mono text-gray-400 space-y-0.5 divide-y divide-gray-900/40">
                              {Object.entries(log.headers).map(([key, val]) => (
                                <div key={key} className="flex justify-between py-1">
                                  <span className="text-sky-500/80 font-semibold">{key}:</span>
                                  <span className="text-gray-300 text-right truncate pl-4 max-w-[250px]">{val}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Body if present */}
                          {hasBody && (
                            <div className="space-y-1 bg-gray-900/40 p-2.5 rounded border border-gray-800">
                              <span className="text-[10px] uppercase font-bold text-gray-500 font-mono">Request Body ({typeof log.body === 'object' ? 'JSON' : 'Raw'})</span>
                              <pre className="text-[10px] font-mono text-amber-300 overflow-x-auto whitespace-pre-wrap max-h-[180px] leading-relaxed">
                                {formatPayload(log.body)}
                              </pre>
                            </div>
                          )}
                        </div>

                        {/* Response section */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide border-b border-gray-800 pb-1 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span>Outgoing Served Response</span>
                          </h4>

                          {/* Response Headers */}
                          <div className="space-y-1 bg-gray-900/40 p-2.5 rounded border border-gray-800">
                            <span className="text-[10px] uppercase font-bold text-gray-500 font-mono">Response Headers</span>
                            <div className="max-h-[150px] overflow-y-auto text-[10px] font-mono text-gray-400 space-y-0.5 divide-y divide-gray-900/40">
                              {Object.entries(log.responseHeaders).map(([key, val]) => (
                                <div key={key} className="flex justify-between py-1">
                                  <span className="text-emerald-500/80 font-semibold">{key}:</span>
                                  <span className="text-gray-300 text-right truncate pl-4 max-w-[250px]">{val}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Response Body */}
                          <div className="space-y-1 bg-gray-900/40 p-2.5 rounded border border-gray-800">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] uppercase font-bold text-gray-500 font-mono">Response Body</span>
                              <span className="text-[9px] text-gray-500">{log.responseBody ? `${log.responseBody.length} chars` : 'empty'}</span>
                            </div>
                            <pre className="text-[10px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap max-h-[180px] leading-relaxed bg-gray-950 p-2 rounded">
                              {formatPayload(log.responseBody)}
                            </pre>
                          </div>
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
