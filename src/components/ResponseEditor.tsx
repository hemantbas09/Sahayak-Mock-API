import React, { useState } from 'react';
import { 
  Plus, 
  Trash2, 
  Info, 
  Code, 
  Settings2, 
  HelpCircle,
  Copy,
  FolderOpen,
  ShieldCheck
} from 'lucide-react';
import { RouteResponse, RouteRule, KeyValue, RuleTarget, RuleOperator } from '../types';

interface ResponseEditorProps {
  response: RouteResponse;
  onChangeResponse: (updated: RouteResponse) => void;
  onShowAlert?: (title: string, message: string) => void;
  routeMethod?: string;
}

export default function ResponseEditor({
  response,
  onChangeResponse,
  onShowAlert,
  routeMethod
}: ResponseEditorProps) {
  const [activeSubTab, setActiveSubTab] = useState<'body' | 'headers' | 'rules' | 'validation'>('body');

  // Common response headers for autocomplete
  const commonHeaders = [
    'Content-Type',
    'Cache-Control',
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Headers',
    'Access-Control-Allow-Methods',
    'Authorization',
    'X-Requested-With',
    'X-Powered-By',
    'ETag'
  ];

  // Common Header Values
  const commonHeaderValues: Record<string, string[]> = {
    'Content-Type': [
      'application/json; charset=utf-8',
      'text/plain; charset=utf-8',
      'text/html; charset=utf-8',
      'application/xml; charset=utf-8',
      'application/x-www-form-urlencoded'
    ],
    'Access-Control-Allow-Origin': ['*', 'http://localhost:3000'],
    'Cache-Control': ['no-cache, no-store, must-revalidate', 'max-age=3600', 'public, max-age=86400'],
    'X-Powered-By': ['Express', 'Mockoon-Clone', 'Next.js']
  };

  // Common status codes
  const statusCodes = [
    { code: 200, text: '200 OK' },
    { code: 201, text: '201 Created' },
    { code: 202, text: '202 Accepted' },
    { code: 204, text: '204 No Content' },
    { code: 301, text: '301 Moved Permanently' },
    { code: 302, text: '302 Found' },
    { code: 400, text: '400 Bad Request' },
    { code: 401, text: '401 Unauthorized' },
    { code: 403, text: '403 Forbidden' },
    { code: 404, text: '404 Not Found' },
    { code: 409, text: '409 Conflict' },
    { code: 422, text: '422 Unprocessable Entity' },
    { code: 429, text: '429 Too Many Requests' },
    { code: 500, text: '500 Internal Server Error' },
    { code: 503, text: '503 Service Unavailable' }
  ];

  // Headers CRUD
  const handleAddHeader = () => {
    const newHeader: KeyValue = {
      id: 'h-' + Math.random().toString(36).substr(2, 9),
      key: '',
      value: ''
    };
    onChangeResponse({
      ...response,
      headers: [...response.headers, newHeader]
    });
  };

  const handleUpdateHeader = (id: string, key: 'key' | 'value', val: string) => {
    onChangeResponse({
      ...response,
      headers: response.headers.map(h => h.id === id ? { ...h, [key]: val } : h)
    });
  };

  const handleDeleteHeader = (id: string) => {
    onChangeResponse({
      ...response,
      headers: response.headers.filter(h => h.id !== id)
    });
  };

  // Rules CRUD
  const handleAddRule = () => {
    const newRule: RouteRule = {
      id: 'rule-' + Math.random().toString(36).substr(2, 9),
      target: 'query',
      property: '',
      operator: 'equals',
      value: ''
    };
    onChangeResponse({
      ...response,
      rules: [...(response.rules || []), newRule]
    });
  };

  const handleUpdateRule = (id: string, field: keyof RouteRule, val: any) => {
    onChangeResponse({
      ...response,
      rules: (response.rules || []).map(r => r.id === id ? { ...r, [field]: val } : r)
    });
  };

  const handleDeleteRule = (id: string) => {
    onChangeResponse({
      ...response,
      rules: (response.rules || []).filter(r => r.id !== id)
    });
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(response.body);
      onChangeResponse({
        ...response,
        body: JSON.stringify(parsed, null, 2)
      });
    } catch (err: any) {
      if (onShowAlert) {
        onShowAlert('JSON Parse Error', `Cannot format the JSON body because it contains syntax errors: ${err.message}`);
      } else {
        alert('Invalid JSON! Cannot format.');
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-900 text-gray-300">
      {/* Response Bar */}
      <div className="p-4 border-b border-gray-800 bg-gray-950 flex flex-wrap items-center gap-4 shrink-0">
        {/* Status Code Selection */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-400">Status:</label>
          <select
            value={response.statusCode}
            onChange={(e) => onChangeResponse({ ...response, statusCode: parseInt(e.target.value, 10) })}
            className="bg-gray-900 border border-gray-800 hover:border-gray-700 text-gray-200 text-xs rounded px-2 py-1 outline-none font-mono cursor-pointer"
          >
            {statusCodes.map(sc => (
              <option key={sc.code} value={sc.code}>{sc.text}</option>
            ))}
          </select>
        </div>

        {/* Label description of Response */}
        <div className="flex-1 min-w-[200px] flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-400">Label:</label>
          <input
            type="text"
            value={response.label}
            placeholder="e.g. Success, Missing Fields, Auth Fail"
            onChange={(e) => onChangeResponse({ ...response, label: e.target.value })}
            className="flex-1 bg-gray-900 border border-gray-800 hover:border-gray-700 text-gray-200 text-xs rounded px-3 py-1 outline-none focus:border-sky-500/50"
          />
        </div>

        {/* Rules toggle overview */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400 font-semibold">Rules:</span>
          {response.rules && response.rules.length > 0 ? (
            <span className="bg-sky-500/10 border border-sky-500/30 text-sky-400 px-2 py-0.5 rounded-full font-semibold">
              {response.rules.length} conditions ({response.rulesOperator})
            </span>
          ) : (
            <span className="text-gray-500">None (Default Response)</span>
          )}
        </div>
      </div>

      {/* Response Navigation sub-tabs */}
      <div className="flex border-b border-gray-800 bg-gray-950/40 shrink-0">
        <button
          onClick={() => setActiveSubTab('body')}
          className={`px-5 py-2.5 text-xs font-semibold border-b-2 tracking-wide transition-colors cursor-pointer ${
            activeSubTab === 'body'
              ? 'border-sky-500 text-sky-400 bg-gray-900/40'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900/10'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Code size={14} />
            <span>Response Body</span>
          </div>
        </button>
        <button
          onClick={() => setActiveSubTab('headers')}
          className={`px-5 py-2.5 text-xs font-semibold border-b-2 tracking-wide transition-colors cursor-pointer ${
            activeSubTab === 'headers'
              ? 'border-sky-500 text-sky-400 bg-gray-900/40'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900/10'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Settings2 size={14} />
            <span>Response Headers ({response.headers.length})</span>
          </div>
        </button>
        <button
          onClick={() => setActiveSubTab('rules')}
          className={`px-5 py-2.5 text-xs font-semibold border-b-2 tracking-wide transition-colors cursor-pointer ${
            activeSubTab === 'rules'
              ? 'border-sky-500 text-sky-400 bg-gray-900/40'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900/10'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Info size={14} />
            <span>Response Rules ({response.rules?.length || 0})</span>
          </div>
        </button>
        <button
          onClick={() => setActiveSubTab('validation')}
          className={`px-5 py-2.5 text-xs font-semibold border-b-2 tracking-wide transition-colors cursor-pointer ${
            activeSubTab === 'validation'
              ? 'border-sky-500 text-sky-400 bg-gray-900/40'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900/10'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={14} className={response.validationInterface && (routeMethod || '').toLowerCase() !== 'get' ? "text-emerald-400" : ""} />
            <span>Payload Validation</span>
            {response.validationInterface && (routeMethod || '').toLowerCase() !== 'get' && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </div>
        </button>
      </div>

      {/* Sub-tab content panels */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {activeSubTab === 'body' && (
          <div className="h-full flex flex-col gap-3 min-h-0">
            {/* Body Editor bar tools */}
            <div className="flex items-center justify-end shrink-0">
              <button
                onClick={formatJson}
                className="text-xs bg-gray-800 border border-gray-700 hover:bg-gray-700 px-2.5 py-1 rounded text-gray-200 font-medium transition-colors cursor-pointer"
              >
                Format JSON
              </button>
            </div>

            {/* Textarea Body Editor */}
            <div className="flex-1 min-h-0 flex flex-col border border-gray-800 rounded-lg overflow-hidden bg-gray-950">
              <textarea
                value={response.body}
                onChange={(e) => onChangeResponse({ ...response, body: e.target.value })}
                placeholder='e.g. { "id": "{{uuid}}", "status": "active" }'
                className="w-full flex-1 p-3 bg-transparent text-gray-200 font-mono text-xs resize-none outline-none leading-relaxed"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {activeSubTab === 'headers' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center bg-gray-900/40 p-1 rounded-lg">
              <span className="text-xs text-gray-400">Response specific headers. These take priority over environment global headers.</span>
              <button
                onClick={handleAddHeader}
                className="bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs px-3 py-1.5 rounded flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Plus size={14} />
                <span>Add Header</span>
              </button>
            </div>

            {response.headers.length === 0 ? (
              <div className="border border-dashed border-gray-800 rounded-lg p-8 text-center text-gray-500">
                <Settings2 size={24} className="mx-auto mb-2 text-gray-700" />
                <p className="text-xs font-semibold">No custom headers configured</p>
                <p className="text-[11px] text-gray-600 mt-0.5">Click "Add Header" above or inherit from global headers.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {response.headers.map((header) => (
                  <div key={header.id} className="flex gap-2 items-center">
                    {/* Header Key autocomplete list */}
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={header.key}
                        placeholder="e.g. Content-Type"
                        onChange={(e) => handleUpdateHeader(header.id, 'key', e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 text-gray-200 text-xs rounded px-3 py-1.5 outline-none font-mono focus:border-sky-500/50"
                        list="common-headers-list"
                      />
                    </div>
                    {/* Header Value autocomplete list */}
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={header.value}
                        placeholder="e.g. application/json"
                        onChange={(e) => handleUpdateHeader(header.id, 'value', e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 text-gray-200 text-xs rounded px-3 py-1.5 outline-none font-mono focus:border-sky-500/50"
                        list={`common-header-vals-${header.id}`}
                      />
                      {/* Dynamic datalist options for values based on selected header */}
                      {header.key && commonHeaderValues[header.key] && (
                        <datalist id={`common-header-vals-${header.id}`}>
                          {commonHeaderValues[header.key].map(v => (
                            <option key={v} value={v} />
                          ))}
                        </datalist>
                      )}
                    </div>
                    {/* Delete Header */}
                    <button
                      onClick={() => handleDeleteHeader(header.id)}
                      className="p-1.5 hover:bg-gray-800 rounded text-rose-400 hover:text-rose-300 transition-colors shrink-0 cursor-pointer"
                      title="Delete Header"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Global headers list static reference */}
            <datalist id="common-headers-list">
              {commonHeaders.map(ch => (
                <option key={ch} value={ch} />
              ))}
            </datalist>
          </div>
        )}

        {activeSubTab === 'rules' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-gray-900/40 p-1.5 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">Match rules to automatically serve this response based on request payload:</span>
                {response.rules && response.rules.length > 0 && (
                  <div className="flex items-center gap-1.5 bg-gray-950 p-1 rounded-md border border-gray-800">
                    <span className="text-[10px] uppercase font-bold text-gray-400 leading-none">Combine:</span>
                    <select
                      value={response.rulesOperator}
                      onChange={(e) => onChangeResponse({ ...response, rulesOperator: e.target.value as 'AND' | 'OR' })}
                      className="bg-gray-900 text-sky-400 text-[10px] font-bold rounded px-1 outline-none cursor-pointer"
                    >
                      <option value="AND">AND (All Match)</option>
                      <option value="OR">OR (Any Match)</option>
                    </select>
                  </div>
                )}
              </div>
              <button
                onClick={handleAddRule}
                className="bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs px-3 py-1.5 rounded flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Plus size={14} />
                <span>Add Rule</span>
              </button>
            </div>

            {(!response.rules || response.rules.length === 0) ? (
              <div className="border border-dashed border-gray-800 rounded-lg p-8 text-center text-gray-500">
                <Info size={24} className="mx-auto mb-2 text-gray-700" />
                <p className="text-xs font-semibold">No response rules specified</p>
                <p className="text-[11px] text-gray-600 mt-0.5">This response will act as a fallback when no other responses match their rules.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {response.rules.map((rule, idx) => (
                  <div key={rule.id} className="flex flex-wrap gap-2 items-center bg-gray-950 p-3 rounded-lg border border-gray-800 relative group/rule">
                    <span className="text-[10px] font-bold font-mono text-gray-600 shrink-0">#{idx + 1}</span>

                    {/* Target Selector */}
                    <select
                      value={rule.target}
                      onChange={(e) => handleUpdateRule(rule.id, 'target', e.target.value as RuleTarget)}
                      className="bg-gray-900 border border-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none font-semibold cursor-pointer shrink-0"
                    >
                      <option value="query">Query Parameter</option>
                      <option value="header">Request Header</option>
                      <option value="body">Body JSON Path</option>
                      <option value="route_param">Route Parameter</option>
                    </select>

                    {/* Property input (e.g. parameter key name or path) */}
                    {rule.operator !== 'body_required' && rule.operator !== 'body_empty' ? (
                      <input
                        type="text"
                        value={rule.property}
                        placeholder={
                          rule.target === 'query' ? 'e.g. category' :
                          rule.target === 'header' ? 'e.g. Authorization' :
                          rule.target === 'body' ? 'e.g. user.id' : 'e.g. id'
                        }
                        onChange={(e) => handleUpdateRule(rule.id, 'property', e.target.value)}
                        className="flex-1 min-w-[120px] bg-gray-900 border border-gray-800 text-gray-200 text-xs rounded px-3 py-1.5 outline-none font-mono focus:border-sky-500/50"
                      />
                    ) : (
                      <div className="flex-1 min-w-[120px] bg-gray-900/40 border border-gray-800/60 text-gray-500 text-xs rounded px-3 py-1.5 font-mono italic select-none">
                        [Entire Payload Body]
                      </div>
                    )}

                    {/* Operator selector */}
                    <select
                      value={rule.operator}
                      onChange={(e) => handleUpdateRule(rule.id, 'operator', e.target.value as RuleOperator)}
                      className="bg-gray-900 border border-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 outline-none cursor-pointer shrink-0 font-medium"
                    >
                      <option value="equals">equals</option>
                      <option value="not_equals">not equals</option>
                      <option value="contains">contains</option>
                      <option value="not_contains">does not contain</option>
                      <option value="regex">matches regex</option>
                      <option value="null">is null / empty</option>
                      <option value="not_null">is not null / empty</option>
                      
                      {/* Type Validations */}
                      <option value="is_string">is a string</option>
                      <option value="not_is_string">is not a string</option>
                      <option value="is_optional_string">is string if present (optional string)</option>
                      <option value="is_number">is a number</option>
                      <option value="not_is_number">is not a number</option>
                      <option value="is_optional_number">is number if present (optional number)</option>
                      <option value="is_boolean">is a boolean</option>
                      <option value="not_is_boolean">is not a boolean</option>
                      <option value="is_optional_boolean">is boolean if present (optional boolean)</option>
                      <option value="is_array">is an array</option>
                      <option value="not_is_array">is not an array</option>
                      <option value="is_object">is an object</option>
                      <option value="not_is_object">is not an object</option>
                      
                      {/* Structural Validations */}
                      <option value="has_property">has property key</option>
                      <option value="missing_property">missing property key</option>
                      
                      {/* Payload Validations */}
                      <option value="body_required">request body is present & non-empty</option>
                      <option value="body_empty">request body is missing or empty</option>
                    </select>

                    {/* Value input (hidden if operator does not require comparison value) */}
                    {!['null', 'not_null', 'is_string', 'not_is_string', 'is_number', 'not_is_number', 'is_boolean', 'not_is_boolean', 'is_array', 'not_is_array', 'is_object', 'not_is_object', 'has_property', 'missing_property', 'body_required', 'body_empty', 'is_optional_string', 'is_optional_number', 'is_optional_boolean'].includes(rule.operator) && (
                      <input
                        type="text"
                        value={rule.value}
                        placeholder="comparison value"
                        onChange={(e) => handleUpdateRule(rule.id, 'value', e.target.value)}
                        className="flex-1 min-w-[120px] bg-gray-900 border border-gray-800 text-gray-200 text-xs rounded px-3 py-1.5 outline-none font-mono focus:border-sky-500/50"
                      />
                    )}

                    {/* Delete Rule */}
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="p-1.5 hover:bg-gray-800 rounded text-rose-400 hover:text-rose-300 transition-colors shrink-0 cursor-pointer"
                      title="Delete Rule"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSubTab === 'validation' && (routeMethod || '').toLowerCase() === 'get' ? (
          <div className="p-8 bg-gray-950 rounded-xl border border-gray-800/80 flex flex-col items-center justify-center text-center gap-3">
            <ShieldCheck size={36} className="text-gray-600 animate-pulse" />
            <h3 className="text-sm font-semibold text-gray-200">Payload Validation Not Available</h3>
            <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
              GET routes do not transmit request payloads. Contract validation is only available for routes with request bodies, such as POST, PUT, PATCH, and DELETE.
            </p>
          </div>
        ) : activeSubTab === 'validation' && (
          <div className="h-full flex flex-col gap-4 min-h-0">
            {/* Header info */}
            <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 shrink-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-100">
                <ShieldCheck size={16} className="text-emerald-400" />
                <span>Enforce Request Body Contract Validation</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1 leading-normal">
                Automatically validate incoming requests. When a contract/interface is defined below, validation is <strong>always enforced</strong>. Requests not matching the schema are rejected with a <strong>400 Bad Request</strong>.
              </p>
            </div>

            {/* Editor */}
            <div className="flex-1 min-h-0 flex flex-col border border-gray-800 rounded-xl overflow-hidden bg-gray-950">
              <div className="bg-gray-900/60 px-4 py-2 border-b border-gray-800 flex justify-between items-center shrink-0">
                <span className="text-[11px] font-bold text-gray-400 font-mono">PAYLOAD CONTRACT INTERFACE / SCHEMA</span>
                {response.validationInterface && (
                  <button
                    onClick={() => onChangeResponse({ ...response, validationInterface: '' })}
                    className="text-[10px] text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                  >
                    Clear Contract
                  </button>
                )}
              </div>
              <textarea
                value={response.validationInterface || ''}
                onChange={(e) => onChangeResponse({ ...response, validationInterface: e.target.value })}
                placeholder={`// Paste your TypeScript Interface or JSON Schema here\n\nexport interface UserUpdateRequest {\n  name: string;\n  email: string;\n  phone?: string;\n  age?: number;\n  isActive: boolean;\n}`}
                className="w-full flex-1 p-4 bg-transparent text-gray-200 font-mono text-xs resize-none outline-none leading-relaxed"
                spellCheck={false}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
