import React from 'react';
import { 
  Copy, 
  Check, 
  Clock, 
  Plus, 
  Trash2, 
  FileCode,
  Link,
  ChevronRight,
  ArrowUpRight,
  Play,
  X,
  Send,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { MockRoute, RouteResponse, HttpMethod } from '../types';
import ResponseEditor from './ResponseEditor';
import { slugify } from '../lib/slugify';

interface RouteEditorProps {
  route: MockRoute;
  envId: string;
  envName?: string;
  appUrl: string;
  onChangeRoute: (updated: MockRoute) => void;
  onShowAlert?: (title: string, message: string) => void;
}

export default function RouteEditor({
  route,
  envId,
  envName,
  appUrl,
  onChangeRoute,
  onShowAlert
}: RouteEditorProps) {
  const [copiedFriendlyUrl, setCopiedFriendlyUrl] = React.useState(false);
  const [copiedIdUrl, setCopiedIdUrl] = React.useState(false);

  // Test feature panel states
  const [isTestPanelOpen, setIsTestPanelOpen] = React.useState(false);
  const [testPath, setTestPath] = React.useState('');
  const [testHeaders, setTestHeaders] = React.useState<{ key: string; value: string }[]>([]);
  const [testBody, setTestBody] = React.useState('');
  const [testLoading, setTestLoading] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    time: number;
    size: number;
  } | null>(null);
  const [testError, setTestError] = React.useState<string | null>(null);
  const [testTab, setTestTab] = React.useState<'headers' | 'body'>('headers');
  const [responseViewTab, setResponseViewTab] = React.useState<'body' | 'headers'>('body');
  const [copiedTestBody, setCopiedTestBody] = React.useState(false);

  const activeResponse = route.responses.find(r => r.id === route.selectedResponseId) || route.responses[0];

  const methods: HttpMethod[] = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

  // Method colors for the active dropdown
  const methodColors: Record<HttpMethod, string> = {
    get: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    post: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    put: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    delete: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    patch: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    head: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
    options: 'text-teal-400 bg-teal-500/10 border-teal-500/20'
  };

  // Mock URL constructor
  const getFullMockUrl = (useSlug = false) => {
    const origin = appUrl || window.location.origin;
    const identifier = useSlug && envName ? slugify(envName) : envId;
    return `${origin}/mock/${identifier}/${route.endpoint.replace(/^\/+/, '')}`;
  };

  const handleCopyUrl = (useSlug: boolean) => {
    navigator.clipboard.writeText(getFullMockUrl(useSlug));
    if (useSlug) {
      setCopiedFriendlyUrl(true);
      setTimeout(() => setCopiedFriendlyUrl(false), 2000);
    } else {
      setCopiedIdUrl(true);
      setTimeout(() => setCopiedIdUrl(false), 2000);
    }
  };

  // Reset test state when route changes to pre-fill logically
  React.useEffect(() => {
    // Generate default path by replacing dynamic parameters (like :id) with sample value "123"
    const pathWithSamples = route.endpoint
      .split('/')
      .map(seg => seg.startsWith(':') ? '123' : seg)
      .join('/');
    setTestPath(pathWithSamples);

    // Initial headers
    const initialHeaders = [
      { key: 'Accept', value: 'application/json' }
    ];
    if (['post', 'put', 'patch'].includes(route.method.toLowerCase())) {
      initialHeaders.push({ key: 'Content-Type', value: 'application/json' });
    }
    setTestHeaders(initialHeaders);

    // Initial request body based on route method and current response body (as template)
    let initialBody = '';
    if (['post', 'put', 'patch'].includes(route.method.toLowerCase()) && activeResponse) {
      initialBody = activeResponse.body || '';
    }
    setTestBody(initialBody);

    // Clear previous results
    setTestResult(null);
    setTestError(null);
    setTestTab(route.method.toLowerCase() === 'get' ? 'headers' : 'body');
  }, [route.id, route.endpoint, route.method]);

  // Execute request test
  const handleExecuteTest = async () => {
    setTestLoading(true);
    setTestError(null);
    setTestResult(null);

    const origin = appUrl || window.location.origin;
    const cleanPath = testPath.replace(/^\/+/, '');
    const identifier = envName ? slugify(envName) : envId;
    const url = `${origin}/mock/${identifier}/${cleanPath}`;

    const headersObj: Record<string, string> = {};
    testHeaders.forEach(h => {
      if (h.key.trim()) {
        headersObj[h.key.trim()] = h.value;
      }
    });

    const options: RequestInit = {
      method: route.method.toUpperCase(),
      headers: headersObj,
    };

    if (!['get', 'head'].includes(route.method.toLowerCase()) && testBody) {
      options.body = testBody;
    }

    const startTime = performance.now();

    try {
      const response = await fetch(url, options);
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);

      const status = response.status;
      const statusText = response.statusText;

      // Extract response headers
      const resHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });

      // Extract response body
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch (err: any) {
        bodyText = `Failed to read response body: ${err.message}`;
      }

      setTestResult({
        status,
        statusText,
        headers: resHeaders,
        body: bodyText,
        time: latency,
        size: bodyText.length,
      });
    } catch (err: any) {
      setTestError(err.message || 'Network error or request blocked by CORS.');
    } finally {
      setTestLoading(false);
    }
  };

  const handleCopyTestBody = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTestBody(true);
    setTimeout(() => setCopiedTestBody(false), 2000);
  };

  // Responses Management
  const handleAddResponse = () => {
    const newId = 'resp-' + Math.random().toString(36).substr(2, 9);
    const newResponse: RouteResponse = {
      id: newId,
      statusCode: 200,
      label: `Response ${route.responses.length + 1}`,
      headers: [],
      body: '{}',
      rules: [],
      rulesOperator: 'AND'
    };

    onChangeRoute({
      ...route,
      responses: [...route.responses, newResponse],
      selectedResponseId: newId
    });
  };

  const handleDeleteResponse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (route.responses.length <= 1) {
      if (onShowAlert) {
        onShowAlert('Cannot Delete Response', 'A route must have at least one response configuration.');
      } else {
        alert('A route must have at least one response.');
      }
      return;
    }

    const updatedResponses = route.responses.filter(r => r.id !== id);
    const wasSelected = route.selectedResponseId === id;
    const newSelectedId = wasSelected ? updatedResponses[0].id : route.selectedResponseId;

    onChangeRoute({
      ...route,
      responses: updatedResponses,
      selectedResponseId: newSelectedId
    });
  };

  const handleUpdateResponse = (updatedResp: RouteResponse) => {
    onChangeRoute({
      ...route,
      responses: route.responses.map(r => r.id === updatedResp.id ? updatedResp : r)
    });
  };

  return (
    <div className="flex-1 flex flex-row min-h-0 bg-gray-950 text-gray-200 overflow-hidden">
      {/* Central Route Config Editor */}
      <div className="flex-1 flex flex-col min-h-0 border-r border-gray-800">
        {/* Upper Panel: Route Endpoint Metadata Settings */}
        <div className="p-4 border-b border-gray-800 bg-gray-950/80 flex flex-col gap-3 shrink-0">
          
          {/* Method & Path & Latency */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Method Badge Dropdown */}
            <select
              value={route.method}
              onChange={(e) => onChangeRoute({ ...route, method: e.target.value as HttpMethod })}
              className={`font-bold uppercase text-xs tracking-wider rounded border px-3 py-1.5 outline-none cursor-pointer leading-none ${methodColors[route.method]}`}
            >
              {methods.map(m => (
                <option key={m} value={m} className="bg-gray-900 text-gray-200 font-bold uppercase">{m}</option>
              ))}
            </select>

            {/* Path Input */}
            <div className="flex-1 min-w-[200px] flex items-center bg-gray-900 border border-gray-800 hover:border-gray-700 focus-within:border-sky-500/50 rounded overflow-hidden">
              <span className="pl-3 text-xs text-gray-500 font-mono select-none">/</span>
              <input
                type="text"
                value={route.endpoint}
                onChange={(e) => onChangeRoute({ ...route, endpoint: e.target.value.replace(/^\/+/, '') })}
                placeholder="e.g. users/:id/profile"
                className="w-full bg-transparent text-gray-100 font-mono text-xs py-1.5 px-1.5 outline-none placeholder:text-gray-600"
              />
            </div>

            {/* Latency Input */}
            <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 hover:border-gray-700 px-3 py-1 rounded">
              <Clock size={14} className="text-gray-400" />
              <input
                type="number"
                min="0"
                value={route.latency || ''}
                onChange={(e) => onChangeRoute({ ...route, latency: parseInt(e.target.value, 10) || 0 })}
                placeholder="0 (inherits)"
                className="w-16 bg-transparent border-none outline-none text-xs text-gray-100 font-mono placeholder:text-gray-600"
                title="Route latency override in milliseconds. If empty/0, inherits global environment setting."
              />
              <span className="text-[10px] font-semibold text-gray-500 select-none">ms</span>
            </div>
          </div>

          {/* Copy Mock URL Row & Description */}
          <div className="flex flex-col gap-2 bg-gray-900/40 p-3 rounded-lg border border-gray-800/40">
            {/* Friendly URL Row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 overflow-hidden text-xs text-gray-400 max-w-full">
                <Link size={14} className="text-sky-400 shrink-0" />
                <span className="text-[10px] font-bold text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded mr-1 uppercase select-none">Mock URL</span>
                <span className="truncate font-mono text-[11px] text-gray-200 selection:bg-sky-500/20">{getFullMockUrl(true)}</span>
                <a 
                  href={getFullMockUrl(true)} 
                  target="_blank" 
                  rel="noreferrer"
                  className="hover:text-sky-400 p-0.5 rounded transition-colors"
                  title="Open Mock API in New Tab"
                >
                  <ArrowUpRight size={13} />
                </a>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopyUrl(true)}
                  className="text-xs font-semibold text-sky-400 hover:text-sky-300 bg-gray-900 border border-gray-800 hover:border-sky-500/20 px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedFriendlyUrl ? (
                    <>
                      <Check size={13} className="text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      <span>Copy URL</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setIsTestPanelOpen(!isTestPanelOpen)}
                  className={`text-xs font-semibold px-3 py-1 rounded transition-all flex items-center gap-1.5 cursor-pointer border ${
                    isTestPanelOpen 
                      ? 'bg-sky-600 hover:bg-sky-500 text-white border-sky-600' 
                      : 'bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border-emerald-500/20'
                  }`}
                >
                  <Play size={13} className={isTestPanelOpen ? "fill-current" : ""} />
                  <span>{isTestPanelOpen ? 'Close Tester' : 'Test Endpoint'}</span>
                </button>
              </div>
            </div>
          </div>


        </div>

        {/* Response Selector Tab Row */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/60 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto select-none no-scrollbar flex-1 mr-3">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider shrink-0 mr-1.5">Responses:</span>
            {route.responses.map((resp, idx) => {
              const isSelected = resp.id === route.selectedResponseId;
              return (
                <button
                  key={resp.id}
                  onClick={() => onChangeRoute({ ...route, selectedResponseId: resp.id })}
                  className={`group px-3 py-1.5 text-xs rounded-md border font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-sky-500/10 border-sky-500/40 text-sky-400'
                      : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-gray-300 hover:border-gray-700'
                  }`}
                >
                  <FileCode size={13} />
                  <span>{resp.statusCode} ({resp.label || `Resp ${idx + 1}`})</span>
                  
                  {/* Condition Indicator Badge */}
                  {resp.rules && resp.rules.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400" title="Has rules conditions" />
                  )}

                  {/* Delete button */}
                  {route.responses.length > 1 && (
                    <Trash2
                      size={11}
                      onClick={(e) => handleDeleteResponse(resp.id, e)}
                      className="ml-1 opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity cursor-pointer"
                      title="Delete Response"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Add Response Button */}
          <button
            onClick={handleAddResponse}
            className="text-xs bg-gray-900 border border-gray-800 hover:border-sky-500/20 text-sky-400 hover:text-sky-300 px-2.5 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            <Plus size={14} />
            <span>Add Response</span>
          </button>
        </div>

        {/* Embedded response configuration editor */}
        {activeResponse ? (
          <ResponseEditor
            response={activeResponse}
            onChangeResponse={handleUpdateResponse}
            onShowAlert={onShowAlert}
            routeMethod={route.method}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p>Please select or add a response.</p>
          </div>
        )}
      </div>

      {/* Live Test Console Panel (Right Side, Collapsible) */}
      {isTestPanelOpen && (
        <div className="w-[440px] bg-gray-950 border-l border-gray-800 flex flex-col min-h-0 shrink-0">
          {/* Header */}
          <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/20 shrink-0">
            <div>
              <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
                <Play size={14} className="text-emerald-400 fill-emerald-400/20 animate-pulse" />
                <span>Test Endpoint</span>
              </h3>
              <p className="text-[10px] text-gray-500 mt-0.5">Test matching routes, templating logic, and active rules live.</p>
            </div>
            <button
              onClick={() => setIsTestPanelOpen(false)}
              className="p-1 rounded hover:bg-gray-900 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
              title="Close Test Panel"
            >
              <X size={15} />
            </button>
          </div>

          {/* Test Console content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5 scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
            
            {/* Request Settings Group */}
            <div className="space-y-3">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Request Configuration</span>
              
              {/* Endpoint path editor */}
              <div className="flex items-center bg-gray-900 border border-gray-800 rounded-lg overflow-hidden font-mono text-xs">
                <span className="px-2.5 py-2 bg-gray-950 text-gray-400 border-r border-gray-800 shrink-0 select-none font-bold uppercase">
                  {route.method}
                </span>
                <span className="pl-3 text-gray-600 select-none font-mono text-[11px] shrink-0">/mock/</span>
                <input
                  type="text"
                  value={testPath}
                  onChange={(e) => setTestPath(e.target.value)}
                  className="flex-1 bg-transparent py-2 px-1 text-gray-200 outline-none font-mono text-xs"
                  placeholder="e.g. users/123"
                  title="Modify path or parameters to test route pattern matches (e.g. users/:id)"
                />
              </div>

              {/* Request Headers & Request Body parameters tabs */}
              <div className="border border-gray-850 rounded-lg overflow-hidden bg-gray-900/10">
                <div className="flex border-b border-gray-850 bg-gray-950/60 text-xs">
                  <button
                    onClick={() => setTestTab('headers')}
                    className={`px-3 py-2 font-medium border-b-2 transition-all cursor-pointer ${
                      testTab === 'headers'
                        ? 'border-sky-500 text-sky-400 bg-sky-500/5'
                        : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Headers ({testHeaders.length})
                  </button>
                  {['post', 'put', 'patch', 'delete'].includes(route.method.toLowerCase()) && (
                    <button
                      onClick={() => setTestTab('body')}
                      className={`px-3 py-2 font-medium border-b-2 transition-all cursor-pointer ${
                        testTab === 'body'
                          ? 'border-sky-500 text-sky-400 bg-sky-500/5'
                          : 'border-transparent text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      Body
                    </button>
                  )}
                </div>

                <div className="p-3">
                  {/* Headers Editor Tab */}
                  {testTab === 'headers' && (
                    <div className="space-y-2">
                      {testHeaders.map((header, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Header Key"
                            value={header.key}
                            onChange={(e) => {
                              const updated = [...testHeaders];
                              updated[idx].key = e.target.value;
                              setTestHeaders(updated);
                            }}
                            className="flex-1 min-w-0 bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 text-xs font-mono text-gray-200 outline-none placeholder:text-gray-600 focus:border-gray-700"
                          />
                          <input
                            type="text"
                            placeholder="Value"
                            value={header.value}
                            onChange={(e) => {
                              const updated = [...testHeaders];
                              updated[idx].value = e.target.value;
                              setTestHeaders(updated);
                            }}
                            className="flex-1 min-w-0 bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 text-xs font-mono text-gray-200 outline-none placeholder:text-gray-600 focus:border-gray-700"
                          />
                          <button
                            onClick={() => setTestHeaders(testHeaders.filter((_, i) => i !== idx))}
                            className="p-1.5 text-gray-500 hover:text-rose-400 hover:bg-rose-500/5 rounded transition-colors cursor-pointer"
                            title="Remove Header"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                      
                      <button
                        onClick={() => setTestHeaders([...testHeaders, { key: '', value: '' }])}
                        className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 mt-1 cursor-pointer"
                      >
                        <Plus size={12} />
                        <span>Add Request Header</span>
                      </button>
                    </div>
                  )}

                  {/* Body Editor Tab */}
                  {testTab === 'body' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-gray-500">JSON Payload</span>
                        {activeResponse && (
                          <button
                            onClick={() => setTestBody(activeResponse.body || '')}
                            className="text-[10px] text-sky-400 hover:text-sky-300 underline cursor-pointer"
                          >
                            Use active response body
                          </button>
                        )}
                      </div>
                      <textarea
                        value={testBody}
                        onChange={(e) => setTestBody(e.target.value)}
                        placeholder='{"userId": 123}'
                        rows={5}
                        className="w-full bg-gray-900 border border-gray-800 hover:border-gray-700 focus:border-sky-500/50 rounded p-2 text-xs font-mono text-gray-200 outline-none resize-y placeholder:text-gray-600 leading-relaxed"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handleExecuteTest}
                disabled={testLoading}
                className={`w-full py-2.5 px-4 rounded-lg font-semibold text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer ${
                  testLoading
                    ? 'bg-gray-850 border border-gray-850 text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white hover:shadow-emerald-900/10'
                }`}
              >
                {testLoading ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>Executing fetch request...</span>
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    <span>Send Request</span>
                  </>
                )}
              </button>
            </div>

            {/* Results Console Group */}
            <div className="pt-2 border-t border-gray-850 space-y-3">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Response Console</span>
              
              {testLoading && (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500 gap-3">
                  <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs font-medium">Querying local mock server...</p>
                </div>
              )}

              {testError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 p-3.5 rounded-lg text-xs flex items-start gap-2.5">
                  <AlertCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">Fetch Execution Failed</p>
                    <p className="text-[11px] leading-relaxed text-rose-300/80">{testError}</p>
                    <p className="text-[10px] text-gray-500 pt-1 leading-normal">
                      Ensure your dev server is running and the route parameter variables match exactly.
                    </p>
                  </div>
                </div>
              )}

              {testResult && (
                <div className="space-y-3">
                  {/* Stats header bar */}
                  <div className="grid grid-cols-3 gap-2 bg-gray-900/60 p-2.5 rounded-lg border border-gray-800 text-center font-mono">
                    <div>
                      <p className="text-[9px] text-gray-500 uppercase tracking-wider">Status</p>
                      <p className={`text-xs font-bold mt-1 flex items-center justify-center gap-1 ${
                        testResult.status >= 200 && testResult.status < 300 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          testResult.status >= 200 && testResult.status < 300 ? 'bg-emerald-400' : 'bg-rose-400'
                        }`} />
                        <span>{testResult.status}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] text-gray-500 uppercase tracking-wider">Time</p>
                      <p className="text-xs font-bold mt-1 text-sky-400">{testResult.time} ms</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-gray-500 uppercase tracking-wider">Size</p>
                      <p className="text-xs font-bold mt-1 text-purple-400">
                        {testResult.size > 1024 
                          ? `${(testResult.size / 1024).toFixed(1)} KB` 
                          : `${testResult.size} B`}
                      </p>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="border border-gray-800 rounded-lg overflow-hidden bg-gray-900/10">
                    <div className="flex border-b border-gray-800 bg-gray-950/60 text-xs">
                      <button
                        onClick={() => setResponseViewTab('body')}
                        className={`px-3 py-2 font-medium border-b-2 transition-all cursor-pointer ${
                          responseViewTab === 'body'
                            ? 'border-sky-500 text-sky-400 bg-sky-500/5'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        Response Body
                      </button>
                      <button
                        onClick={() => setResponseViewTab('headers')}
                        className={`px-3 py-2 font-medium border-b-2 transition-all cursor-pointer ${
                          responseViewTab === 'headers'
                            ? 'border-sky-500 text-sky-400 bg-sky-500/5'
                            : 'border-transparent text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        Headers ({Object.keys(testResult.headers).length})
                      </button>
                    </div>

                    <div className="p-3">
                      {/* Body section */}
                      {responseViewTab === 'body' && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[10px] text-gray-500">
                            <span>Response Payload</span>
                            <button
                              onClick={() => {
                                let bodyToCopy = testResult.body;
                                try {
                                  bodyToCopy = JSON.stringify(JSON.parse(testResult.body), null, 2);
                                } catch (e) {}
                                handleCopyTestBody(bodyToCopy);
                              }}
                              className="text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer font-semibold"
                            >
                              {copiedTestBody ? (
                                <>
                                  <Check size={11} className="text-emerald-400" />
                                  <span className="text-emerald-400">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={11} />
                                  <span>Copy Body</span>
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="w-full bg-gray-950 border border-gray-900 rounded p-3 text-[11px] font-mono text-gray-300 overflow-auto max-h-[250px] leading-relaxed whitespace-pre scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
                            {(() => {
                              try {
                                const parsed = JSON.parse(testResult.body);
                                return JSON.stringify(parsed, null, 2);
                              } catch (e) {
                                return testResult.body || <span className="text-gray-650 italic text-[10px]">No response body returned</span>;
                              }
                            })()}
                          </pre>
                        </div>
                      )}

                      {/* Headers section */}
                      {responseViewTab === 'headers' && (
                        <div className="space-y-2">
                          <span className="text-[10px] text-gray-500 block">HTTP Response headers</span>
                          <div className="bg-gray-950 border border-gray-900 rounded p-2.5 max-h-[250px] overflow-auto scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
                            {Object.keys(testResult.headers).length === 0 ? (
                              <span className="text-gray-600 text-xs italic">No response headers returned</span>
                            ) : (
                              <dl className="grid grid-cols-3 gap-y-2 text-[11px] font-mono leading-relaxed">
                                {Object.entries(testResult.headers).map(([k, v]) => (
                                  <React.Fragment key={k}>
                                    <dt className="col-span-1 text-sky-400 font-semibold truncate pr-2 border-r border-gray-900/40" title={k}>{k}</dt>
                                    <dd className="col-span-2 text-gray-300 pl-3 break-all select-all">{v}</dd>
                                  </React.Fragment>
                                ))}
                              </dl>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!testLoading && !testError && !testResult && (
                <div className="text-center py-12 text-gray-600 border border-dashed border-gray-800 rounded-lg bg-gray-900/5">
                  <Play size={18} className="mx-auto mb-2 text-gray-700" />
                  <p className="text-xs">No request sent yet.</p>
                  <p className="text-[10px] text-gray-600 mt-1">Configure your query variables and click Send Request to test.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
