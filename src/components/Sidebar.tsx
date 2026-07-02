import React, { useState } from 'react';
import { 
  Folder, 
  Plus, 
  Trash2, 
  FileJson, 
  Copy, 
  Settings, 
  ArrowRight,
  Route, 
  ChevronRight,
  Upload,
  Layers,
  Download,
  Search,
  X
} from 'lucide-react';
import { MockEnvironment, MockRoute, HttpMethod } from '../types';
import { slugify } from '../lib/slugify';

interface SidebarProps {
  environments: MockEnvironment[];
  selectedEnvId: string | null;
  selectedRouteId: string | null;
  onSelectEnv: (id: string) => void;
  onSelectRoute: (id: string | null) => void;
  onAddEnv: () => void;
  onDeleteEnv: (id: string) => void;
  onDuplicateEnv: (env: MockEnvironment) => void;
  onAddRoute: () => void;
  onDeleteRoute: (id: string) => void;
  onDuplicateRoute: (route: MockRoute) => void;
  onReorderRoutes: (routes: MockRoute[]) => void;
  onImportEnvironments: (imported: MockEnvironment[]) => void;
  onOpenGlobalSettings: () => void;
  onShowAlert?: (title: string, message: string) => void;
}

export default function Sidebar({
  environments,
  selectedEnvId,
  selectedRouteId,
  onSelectEnv,
  onSelectRoute,
  onAddEnv,
  onDeleteEnv,
  onDuplicateEnv,
  onAddRoute,
  onDeleteRoute,
  onDuplicateRoute,
  onReorderRoutes,
  onImportEnvironments,
  onOpenGlobalSettings,
  onShowAlert
}: SidebarProps) {
  const [draggedRouteIndex, setDraggedRouteIndex] = useState<number | null>(null);
  const [isDragOverFile, setIsDragOverFile] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const activeEnv = environments.find(e => e.id === selectedEnvId);

  const query = searchQuery.trim().toLowerCase();
  const filteredRoutes = query
    ? (activeEnv?.routes || []).filter(r => 
        r.endpoint.toLowerCase().includes(query) || 
        r.method.toLowerCase().includes(query) ||
        (r.description || '').toLowerCase().includes(query)
      )
    : (activeEnv?.routes || []);

  // Method color map
  const methodColorMap: Record<HttpMethod, { bg: string, text: string }> = {
    get: { bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', text: 'text-emerald-400' },
    post: { bg: 'bg-sky-500/10 border-sky-500/30 text-sky-400', text: 'text-sky-400' },
    put: { bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400', text: 'text-amber-400' },
    delete: { bg: 'bg-rose-500/10 border-rose-500/30 text-rose-400', text: 'text-rose-400' },
    patch: { bg: 'bg-purple-500/10 border-purple-500/30 text-purple-400', text: 'text-purple-400' },
    head: { bg: 'bg-gray-500/10 border-gray-500/30 text-gray-400', text: 'text-gray-400' },
    options: { bg: 'bg-teal-500/10 border-teal-500/30 text-teal-400', text: 'text-teal-400' }
  };

  // HTML5 Drag and Drop for routes
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedRouteIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedRouteIndex === null || draggedRouteIndex === index || !activeEnv) return;

    const reorderedRoutes = [...activeEnv.routes];
    const [draggedItem] = reorderedRoutes.splice(draggedRouteIndex, 1);
    reorderedRoutes.splice(index, 0, draggedItem);

    onReorderRoutes(reorderedRoutes);
    setDraggedRouteIndex(null);
  };

  // Drag and drop Mockoon/OpenAPI JSON file import
  const handleFileDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverFile(true);
  };

  const handleFileDragLeave = () => {
    setIsDragOverFile(false);
  };

  // Helper to detect Postman collections
  const isPostmanCollection = (obj: any): boolean => {
    return !!(obj && typeof obj === 'object' && obj.info && typeof obj.info === 'object' && obj.info.name && Array.isArray(obj.item));
  };

  // Helper to convert Postman Collection to MockEnvironment
  const convertPostmanCollection = (postman: any): MockEnvironment => {
    const routes: MockRoute[] = [];
    
    const extractItems = (items: any[]) => {
      items.forEach((item: any) => {
        if (!item) return;
        if (item.request && typeof item.request === 'object') {
          const req = item.request;
          const method = (req.method || 'GET').toLowerCase() as HttpMethod;
          
          let endpoint = '';
          if (typeof req.url === 'string') {
            endpoint = req.url;
          } else if (req.url && typeof req.url === 'object') {
            if (Array.isArray(req.url.path)) {
              endpoint = req.url.path.join('/');
            } else if (req.url.raw) {
              endpoint = req.url.raw;
            }
          }
          
          // Clean up endpoints (remove variables, domains, etc.)
          endpoint = endpoint.replace(/^https?:\/\/[^\/]+/, '');
          endpoint = endpoint.replace(/^\{\{\w+\}\}\//, '');
          endpoint = endpoint.replace(/^\/+/, '');
          
          const routeId = 'route-' + Math.random().toString(36).substr(2, 9);
          const responseId = 'resp-' + Math.random().toString(36).substr(2, 9);
          
          let body = '{}';
          let statusCode = 200;
          let responseHeaders: { id: string, key: string, value: string }[] = [];

          if (Array.isArray(item.response) && item.response.length > 0) {
            const resp = item.response[0];
            body = resp.body || '{}';
            statusCode = resp.code || 200;
            if (Array.isArray(resp.header)) {
              responseHeaders = resp.header.map((h: any, hidx: number) => ({
                id: 'rh-' + hidx + '-' + Math.random().toString(36).substr(2, 5),
                key: h.key || '',
                value: h.value || ''
              }));
            }
          } else if (req.body && req.body.mode === 'raw' && req.body.raw) {
            body = req.body.raw;
          }

          // Auto-detect Content-Type: application/json if we have no response headers and the body starts like JSON
          if (responseHeaders.length === 0) {
            const trimmedBody = body.trim();
            if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
              responseHeaders.push({
                id: 'rh-ct-' + Math.random().toString(36).substr(2, 5),
                key: 'Content-Type',
                value: 'application/json'
              });
            }
          }
          
          routes.push({
            id: routeId,
            method: method,
            endpoint: endpoint || 'api/endpoint',
            description: item.name || req.description || '',
            latency: 0,
            responses: [{
              id: responseId,
              statusCode: statusCode,
              label: 'Default Response',
              headers: responseHeaders,
              body: body,
              rules: [],
              rulesOperator: 'AND'
            }],
            selectedResponseId: responseId
          });
        } else if (Array.isArray(item.item)) {
          extractItems(item.item);
        }
      });
    };
    
    if (Array.isArray(postman.item)) {
      extractItems(postman.item);
    }
    
    return {
      id: 'env-' + Math.random().toString(36).substr(2, 9),
      name: postman.info.name || 'Imported Postman Collection',
      endpointPrefix: '',
      port: 3000,
      latency: 0,
      headers: [
        { id: 'h-' + Math.random().toString(36).substr(2, 5), key: 'Content-Type', value: 'application/json' },
        { id: 'h-' + Math.random().toString(36).substr(2, 5), key: 'Access-Control-Allow-Origin', value: '*' }
      ],
      routes: routes
    };
  };

  // Helper to detect OpenAPI / Swagger specification
  const isOpenApi = (obj: any): boolean => {
    return !!(obj && typeof obj === 'object' && (obj.openapi || obj.swagger || obj.paths));
  };

  // Helper to convert OpenAPI to MockEnvironment
  const convertOpenApi = (openapi: any): MockEnvironment => {
    const routes: MockRoute[] = [];
    const pathsObj = openapi.paths || {};
    
    Object.keys(pathsObj).forEach((pathKey) => {
      const pathItem = pathsObj[pathKey];
      if (pathItem && typeof pathItem === 'object') {
        const cleanPath = pathKey.replace(/^\/+/, '');
        const methods: HttpMethod[] = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];
        
        methods.forEach((method) => {
          const operation = pathItem[method];
          if (operation && typeof operation === 'object') {
            const routeId = 'route-' + Math.random().toString(36).substr(2, 9);
            const responseId = 'resp-' + Math.random().toString(36).substr(2, 9);
            
            let body = '{}';
            let statusCode = 200;
            
            if (operation.responses) {
              const okResp = operation.responses['200'] || operation.responses['201'] || Object.values(operation.responses)[0];
              if (okResp && typeof okResp === 'object') {
                if (okResp.content && okResp.content['application/json'] && okResp.content['application/json'].example) {
                  body = JSON.stringify(okResp.content['application/json'].example, null, 2);
                } else if (okResp.content && okResp.content['application/json'] && okResp.content['application/json'].schema) {
                  body = JSON.stringify({ message: `Mocked response for ${method.toUpperCase()} /${cleanPath}` }, null, 2);
                }
              }
            }
            
            routes.push({
              id: routeId,
              method: method,
              endpoint: cleanPath,
              description: operation.summary || operation.description || `OpenAPI ${method.toUpperCase()} ${pathKey}`,
              latency: 0,
              responses: [{
                id: responseId,
                statusCode: statusCode,
                label: 'Default Response',
                headers: [],
                body: body,
                rules: [],
                rulesOperator: 'AND'
              }],
              selectedResponseId: responseId
            });
          }
        });
      }
    });
    
    return {
      id: 'env-' + Math.random().toString(36).substr(2, 9),
      name: (openapi.info && openapi.info.title) || 'Imported OpenAPI Spec',
      endpointPrefix: '',
      port: 3000,
      latency: 0,
      headers: [
        { id: 'h-' + Math.random().toString(36).substr(2, 5), key: 'Content-Type', value: 'application/json' },
        { id: 'h-' + Math.random().toString(36).substr(2, 5), key: 'Access-Control-Allow-Origin', value: '*' }
      ],
      routes: routes
    };
  };

  // Robust helper to parse multiple Mockoon or native configuration formats
  const parseImportedJson = (parsed: any): MockEnvironment[] => {
    let importedEnvs: MockEnvironment[] = [];

    const isMockoonEnv = (obj: any): boolean => {
      return !!(obj && typeof obj === 'object' && Array.isArray(obj.routes));
    };

    const isNativeEnv = (obj: any): boolean => {
      return !!(obj && typeof obj === 'object' && Array.isArray(obj.routes));
    };

    if (!parsed || typeof parsed !== 'object') {
      return [];
    }

    // Helper to find any objects with a routes array recursively
    const findRoutesEnvironments = (val: any): any[] => {
      if (!val || typeof val !== 'object') return [];
      
      let results: any[] = [];
      
      // If this object itself has a 'routes' array, it is likely an environment!
      if (Array.isArray(val.routes)) {
        results.push(val);
      } else {
        // Otherwise search its values recursively
        for (const key of Object.keys(val)) {
          if (key === 'routes') continue;
          results = results.concat(findRoutesEnvironments(val[key]));
        }
      }
      return results;
    };

    // 1. Postman Collection
    if (isPostmanCollection(parsed)) {
      importedEnvs.push(convertPostmanCollection(parsed));
    }
    // 2. OpenAPI Spec
    else if (isOpenApi(parsed)) {
      importedEnvs.push(convertOpenApi(parsed));
    }
    // 3. Standard Mockoon Export file wrapper containing 'source: mockoon' and 'data' array
    else if (parsed.source && String(parsed.source).toLowerCase().includes('mockoon') && Array.isArray(parsed.data)) {
      parsed.data.forEach((entry: any) => {
        if (!entry) return;
        // Check entry itself
        if (isMockoonEnv(entry)) {
          importedEnvs.push(convertMockoonEnv(entry));
        }
        // Check entry.item
        else if (entry.item && isMockoonEnv(entry.item)) {
          importedEnvs.push(convertMockoonEnv(entry.item));
        }
        // Search recursively within entry
        else {
          const found = findRoutesEnvironments(entry);
          found.forEach(item => {
            if (isMockoonEnv(item)) {
              importedEnvs.push(convertMockoonEnv(item));
            }
          });
        }
      });
    }
    // 4. Single standard Mockoon Environment file
    else if (isMockoonEnv(parsed)) {
      importedEnvs.push(convertMockoonEnv(parsed));
    }
    // 5. Native format single environment
    else if (isNativeEnv(parsed)) {
      importedEnvs.push(parsed);
    }
    // 6. An array of configurations
    else if (Array.isArray(parsed)) {
      parsed.forEach((item: any) => {
        if (!item) return;
        if (isPostmanCollection(item)) {
          importedEnvs.push(convertPostmanCollection(item));
        } else if (isOpenApi(item)) {
          importedEnvs.push(convertOpenApi(item));
        } else if (isMockoonEnv(item)) {
          importedEnvs.push(convertMockoonEnv(item));
        } else if (item.item && isMockoonEnv(item.item)) {
          importedEnvs.push(convertMockoonEnv(item.item));
        } else if (isNativeEnv(item)) {
          importedEnvs.push(item);
        } else {
          // Recursive find in item
          const found = findRoutesEnvironments(item);
          found.forEach(subItem => {
            if (isMockoonEnv(subItem)) {
              importedEnvs.push(convertMockoonEnv(subItem));
            }
          });
        }
      });
    }

    // 7. Fallback: Search the entire object recursively
    if (importedEnvs.length === 0) {
      const found = findRoutesEnvironments(parsed);
      found.forEach(item => {
        if (isMockoonEnv(item)) {
          importedEnvs.push(convertMockoonEnv(item));
        }
      });
    }

    return importedEnvs;
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverFile(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Be highly permissive: try to read any dropped file and parse as JSON
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          const importedEnvs = parseImportedJson(parsed);

          if (importedEnvs.length > 0) {
            onImportEnvironments(importedEnvs);
          } else {
            if (onShowAlert) {
              onShowAlert('Import Failed', 'Unrecognized config format. Make sure you dropped a valid Mockoon export, Postman collection, OpenAPI spec, standard environment configuration, or compatible JSON file.');
            } else {
              alert('Unrecognized config format. Make sure you dropped a valid Mockoon export, Postman collection, OpenAPI spec, standard environment configuration, or compatible JSON file.');
            }
          }
        } catch (err) {
          console.error('File parse error:', err);
          if (onShowAlert) {
            onShowAlert('Parse Error', 'Failed to parse the dropped JSON file. Please ensure it is valid, well-formed JSON.');
          } else {
            alert('Failed to parse the dropped JSON file. Please ensure it is valid JSON.');
          }
        }
      };
      reader.readAsText(file);
    }
  };

  // Simple Mockoon format converter to make compatibility awesome!
  const convertMockoonEnv = (mockoon: any): MockEnvironment => {
    return {
      id: mockoon.uuid || 'env-' + Math.random().toString(36).substr(2, 9),
      name: mockoon.name || 'Imported Mockoon API',
      endpointPrefix: mockoon.endpointPrefix || '',
      port: mockoon.port || 3000,
      latency: mockoon.latency || 0,
      headers: (mockoon.headers || []).map((h: any, idx: number) => ({
        id: 'h-' + idx + '-' + Math.random().toString(36).substr(2, 5),
        key: h.key || '',
        value: h.value || ''
      })),
      routes: (mockoon.routes || []).map((r: any) => {
        const routeId = r.uuid || 'route-' + Math.random().toString(36).substr(2, 9);
        const responses = (r.responses || []).map((resp: any, idx: number) => ({
          id: resp.uuid || 'resp-' + idx + '-' + Math.random().toString(36).substr(2, 9),
          statusCode: resp.statusCode || 200,
          label: resp.label || `Response ${idx + 1}`,
          headers: (resp.headers || []).map((h: any, hidx: number) => ({
            id: 'rh-' + hidx + '-' + Math.random().toString(36).substr(2, 5),
            key: h.key || '',
            value: h.value || ''
          })),
          body: resp.body || '',
          rulesOperator: resp.rulesOperator === 'OR' ? 'OR' : 'AND',
          rules: (resp.rules || []).map((rule: any, ridx: number) => ({
            id: 'rule-' + ridx + '-' + Math.random().toString(36).substr(2, 5),
            target: rule.target === 'header' || rule.target === 'query' || rule.target === 'body' || rule.target === 'route_param' ? rule.target : 'query',
            property: rule.property || '',
            operator: rule.operator || 'equals',
            value: rule.value || ''
          }))
        }));

        return {
          id: routeId,
          method: (r.method || 'get').toLowerCase() as HttpMethod,
          endpoint: r.endpoint || '',
          description: r.documentation || '',
          latency: r.latency || 0,
          responses: responses.length > 0 ? responses : [{
            id: 'resp-' + Math.random().toString(36).substr(2, 9),
            statusCode: 200,
            label: 'Default Response',
            headers: [],
            body: '{}',
            rules: [],
            rulesOperator: 'AND'
          }],
          selectedResponseId: responses[0]?.id || ''
        };
      })
    };
  };

  // Convert our custom format back to Mockoon compatible format
  const convertToMockoonEnv = (env: MockEnvironment) => {
    return {
      uuid: env.id,
      name: env.name,
      endpointPrefix: env.endpointPrefix,
      port: env.port,
      latency: env.latency,
      headers: (env.headers || []).map(h => ({
        key: h.key,
        value: h.value
      })),
      routes: (env.routes || []).map(r => ({
        uuid: r.id,
        method: r.method,
        endpoint: r.endpoint,
        documentation: r.description,
        latency: r.latency,
        responses: (r.responses || []).map(resp => ({
          uuid: resp.id,
          statusCode: resp.statusCode,
          label: resp.label,
          headers: (resp.headers || []).map(h => ({
            key: h.key,
            value: h.value
          })),
          body: resp.body,
          rulesOperator: resp.rulesOperator || 'AND',
          rules: (resp.rules || []).map(rule => ({
            target: rule.target,
            property: rule.property,
            operator: rule.operator,
            value: rule.value
          }))
        }))
      }))
    };
  };

  const downloadJSON = (data: any, fileName: string) => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", fileName);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err) {
      console.error("Failed to download file:", err);
      alert("Failed to export configuration. Please try again.");
    }
  };

  const handleExportNative = () => {
    if (!activeEnv) return;
    downloadJSON(activeEnv, `${activeEnv.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-native.json`);
    setShowExportMenu(false);
  };

  const handleExportMockoon = () => {
    if (!activeEnv) return;
    const mockoonFormat = convertToMockoonEnv(activeEnv);
    downloadJSON(mockoonFormat, `${activeEnv.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-mockoon.json`);
    setShowExportMenu(false);
  };

  const handleManualImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          const importedEnvs = parseImportedJson(parsed);

          if (importedEnvs.length > 0) {
            onImportEnvironments(importedEnvs);
          } else {
            if (onShowAlert) {
              onShowAlert('Import Failed', 'Unrecognized configuration format. Make sure you selected a valid Mockoon export, Postman collection, OpenAPI spec, standard environment configuration, or compatible JSON file.');
            } else {
              alert('Unrecognized configuration format. Make sure you selected a valid Mockoon export, Postman collection, OpenAPI spec, standard environment configuration, or compatible JSON file.');
            }
          }
        } catch (err) {
          console.error('File parse error:', err);
          if (onShowAlert) {
            onShowAlert('Parse Error', 'Failed to parse the JSON file. Please ensure it is a valid, well-formed JSON document.');
          } else {
            alert('Failed to parse the JSON file. Please ensure it is valid JSON.');
          }
        }
      };
      reader.readAsText(file);
    }
    // Clear input so selecting the same file triggers onChange again
    e.target.value = '';
  };

  return (
    <div 
      className={`w-80 flex flex-col border-r border-gray-800 bg-gray-950 text-gray-300 select-none transition-colors duration-200 ${
        isDragOverFile ? 'border-sky-500/80 bg-sky-950/20' : ''
      }`}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {/* File Drop Overlay Warning */}
      {isDragOverFile && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gray-950/90 text-sky-400 border-2 border-dashed border-sky-500 pointer-events-none p-6 text-center animate-pulse">
          <Upload size={48} className="mb-3 animate-bounce" />
          <p className="font-semibold text-lg">Drop JSON Config Here</p>
          <p className="text-sm text-gray-400 mt-1">Supports Mockoon Environment & compatible API export files</p>
        </div>
      )}

      {/* Title & Environments Header */}
      <div className="p-4 border-b border-gray-800 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="text-sky-400" size={20} />
            <span className="font-bold text-gray-100 tracking-tight text-sm uppercase">Mock Environments</span>
          </div>
          <div className="flex items-center gap-1">
            <label 
              className="p-1 hover:bg-gray-800 rounded text-sky-400 hover:text-sky-300 transition-colors cursor-pointer flex items-center justify-center"
              title="Import Environment (Mockoon or Native JSON)"
            >
              <Upload size={16} />
              <input 
                type="file" 
                accept=".json" 
                onChange={handleManualImport} 
                className="hidden" 
              />
            </label>
            <button 
              onClick={onAddEnv}
              className="p-1 hover:bg-gray-800 rounded text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
              title="Create Environment"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        {/* Environments list dropdown */}
        <div className="relative">
          <select
            value={selectedEnvId || ''}
            onChange={(e) => onSelectEnv(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 text-gray-200 py-1.5 px-3 rounded-md text-sm outline-none focus:border-sky-500/50 appearance-none cursor-pointer"
          >
            {environments.length === 0 && (
              <option value="">No environments</option>
            )}
            {environments.map(env => (
              <option key={env.id} value={env.id}>
                📁 {env.name} {env.endpointPrefix ? `(/${env.endpointPrefix})` : ''}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
            <ChevronRight size={16} className="transform rotate-90" />
          </div>
        </div>

        {activeEnv && (
          <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
              <span className="truncate">Running: <strong className="text-gray-300" title={`Environment ID: ${activeEnv.id}`}>/mock/{slugify(activeEnv.name)}</strong></span>
            </div>
            <div className="flex items-center gap-2 relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className={`p-0.5 rounded transition-colors cursor-pointer ${
                  showExportMenu ? 'text-sky-400 bg-gray-800' : 'hover:text-sky-400 text-gray-400'
                }`}
                title="Export Environment Configuration"
              >
                <Download size={14} />
              </button>

              {/* Export menu popup */}
              {showExportMenu && (
                <>
                  <div 
                    className="fixed inset-0 z-40 cursor-default" 
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowExportMenu(false);
                    }}
                  />
                  <div className="absolute right-0 top-6 mt-1 w-64 rounded-md shadow-xl bg-gray-900 border border-gray-800 focus:outline-none z-50 py-1.5 text-left">
                    <div className="px-3 py-1 border-b border-gray-800 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                      Export Options
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportNative();
                      }}
                      className="w-full text-left px-3.5 py-2 text-xs text-gray-300 hover:bg-gray-800 hover:text-white transition-colors flex flex-col gap-0.5 cursor-pointer"
                    >
                      <span className="font-semibold text-sky-400">Export as Native JSON</span>
                      <span className="text-[10px] text-gray-400 leading-normal">Full native clone configuration, all details preserved</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportMockoon();
                      }}
                      className="w-full text-left px-3.5 py-2 text-xs text-gray-300 hover:bg-gray-800 hover:text-white transition-colors flex flex-col gap-0.5 cursor-pointer"
                    >
                      <span className="font-semibold text-sky-400">Export as Mockoon Format</span>
                      <span className="text-[10px] text-gray-400 leading-normal">Fully compatible schema with standard Mockoon desktop app</span>
                    </button>
                  </div>
                </>
              )}

              <button
                onClick={() => onDuplicateEnv(activeEnv)}
                className="hover:text-sky-400 p-0.5 rounded transition-colors cursor-pointer"
                title="Duplicate Environment"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={() => onOpenGlobalSettings()}
                className="hover:text-sky-400 p-0.5 rounded transition-colors cursor-pointer"
                title="Environment Global Headers & Settings"
              >
                <Settings size={14} />
              </button>
              <button
                onClick={() => onDeleteEnv(activeEnv.id)}
                className="hover:text-rose-400 p-0.5 rounded transition-colors cursor-pointer"
                title="Delete Environment"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Routes List Container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-800 flex items-center justify-between bg-gray-900/40">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 tracking-wider uppercase">
            <Route size={14} className="text-gray-400" />
            <span>Mock Routes ({activeEnv?.routes.length || 0})</span>
          </div>
          {selectedEnvId && (
            <button
              onClick={onAddRoute}
              className="p-1 hover:bg-gray-800 rounded text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 cursor-pointer"
              title="Add Route"
            >
              <Plus size={16} />
              <span className="text-xs font-medium">Add</span>
            </button>
          )}
        </div>

        {/* Search bar */}
        {selectedEnvId && activeEnv && activeEnv.routes.length > 0 && (
          <div className="px-3 py-2 border-b border-gray-800/60 bg-gray-950/20">
            <div className="relative flex items-center">
              <Search size={13} className="absolute left-2.5 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search path or method..."
                className="w-full bg-gray-900/80 hover:bg-gray-900 border border-gray-800 focus:border-sky-500/50 rounded pl-8 pr-7 py-1 text-xs text-gray-300 placeholder-gray-500 focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-gray-500 hover:text-gray-300 p-0.5"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* File Drag and Drop Import Prompt (If no routes/env) */}
        {!selectedEnvId ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center text-center text-gray-500 gap-3 border-t border-gray-800/20">
            <Folder size={40} className="text-gray-700" />
            <div className="text-sm">
              <p className="font-semibold text-gray-400">No Environment Selected</p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Create an environment using the <strong className="text-sky-500/80">+</strong> icon or drop a Mockoon JSON configuration file here.
              </p>
            </div>
            <label className="mt-2 text-xs text-sky-400 hover:text-sky-300 bg-gray-900 border border-gray-800 hover:border-sky-500/30 px-3 py-1.5 rounded cursor-pointer transition-colors flex items-center gap-1.5">
              <FileJson size={14} />
              <span>Import Config File</span>
              <input 
                type="file" 
                accept=".json" 
                onChange={handleManualImport} 
                className="hidden" 
              />
            </label>
          </div>
        ) : activeEnv && activeEnv.routes.length === 0 ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center text-center text-gray-500 gap-2">
            <Route size={32} className="text-gray-700" />
            <div className="text-xs">
              <p className="font-semibold text-gray-400">No Routes Defined</p>
              <p className="text-gray-500 mt-1 leading-relaxed">
                Create a route using the <strong className="text-sky-500/80">Add</strong> button above or drag and drop routes.
              </p>
            </div>
          </div>
        ) : (
          /* Active Routes List */
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredRoutes.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-xs">
                No matching routes found.
              </div>
            ) : (
              filteredRoutes.map((route) => {
                const index = (activeEnv?.routes || []).findIndex(r => r.id === route.id);
                const colors = methodColorMap[route.method];
                const isSelected = route.id === selectedRouteId;
                const activeResponse = route.responses.find(r => r.id === route.selectedResponseId) || route.responses[0];

                return (
                  <div
                    key={route.id}
                    draggable={!searchQuery}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onClick={() => {
                      onSelectRoute(route.id);
                    }}
                    className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-150 border text-left ${
                      isSelected 
                        ? 'bg-sky-500/10 border-sky-500/40 text-gray-100 shadow-md shadow-sky-500/5' 
                        : 'bg-transparent border-transparent hover:bg-gray-900/60 hover:border-gray-800 text-gray-400 hover:text-gray-300'
                    }`}
                    style={{
                      opacity: draggedRouteIndex === index ? 0.4 : 1
                    }}
                  >
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                      {/* Method Badge */}
                      <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border leading-none shrink-0 ${colors.bg}`}>
                        {route.method}
                      </span>
                      {/* Route path */}
                      <span className="font-mono text-xs truncate font-medium tracking-tight">
                        /{route.endpoint || ''}
                      </span>
                    </div>

                    {/* Right tools / indicators */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Latency Indicator */}
                      {route.latency > 0 && (
                        <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1 border border-amber-500/20 rounded">
                          {route.latency}ms
                        </span>
                      )}
                      {/* Status Code Indicator */}
                      {activeResponse && (
                        <span className={`text-[10px] px-1 rounded font-medium border leading-normal ${
                          activeResponse.statusCode >= 200 && activeResponse.statusCode < 300 
                            ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'
                            : activeResponse.statusCode >= 400 
                            ? 'bg-rose-500/5 border-rose-500/10 text-rose-400'
                            : 'bg-amber-500/5 border-amber-500/10 text-amber-400'
                        }`}>
                          {activeResponse.statusCode}
                        </span>
                      )}

                      {/* Copy / Delete buttons hidden until hover */}
                      <div className="hidden group-hover:flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDuplicateRoute(route);
                          }}
                          className="p-0.5 hover:text-sky-400 rounded hover:bg-gray-800 transition-colors"
                          title="Duplicate Route"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteRoute(route.id);
                          }}
                          className="p-0.5 hover:text-rose-400 rounded hover:bg-gray-800 transition-colors"
                          title="Delete Route"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Manual import file bottom bar */}
      <div className="p-3 border-t border-gray-800 bg-gray-950/80 text-center text-xs text-gray-500 flex flex-col gap-1 shrink-0">
        <p>💡 Tip: Drag and drop a Mockoon export file directly into the sidebar to import it instantly!</p>
      </div>
    </div>
  );
}
