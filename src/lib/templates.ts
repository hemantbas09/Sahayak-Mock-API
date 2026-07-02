/**
 * Helper to get a nested value from an object using a dot-notation path
 */
function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    // Check if current is an array and part is an index
    if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (!isNaN(index)) {
        current = current[index];
        continue;
      }
    }
    current = current[part];
  }
  return current;
}

/**
 * Custom template parser for dynamic mock responses
 */
export function parseTemplate(
  template: string,
  requestDetails: {
    query: Record<string, any>;
    body: any;
    headers: Record<string, any>;
    params: Record<string, any>;
  }
): string {
  if (!template) return '';

  // Regex to match {{ ... }}
  const tagRegex = /\{\{\s*([a-zA-Z0-9_]+)(?:\s+['"]([^'"]+)['"])?(?:\s+['"]([^'"]+)['"])?(?:\s+(\d+))?(?:\s+(\d+))?\s*\}\}/g;

  return template.replace(tagRegex, (match, command, arg1, arg2, num1, num2) => {
    try {
      switch (command) {
        case 'query': {
          if (!arg1) return '';
          const val = requestDetails.query[arg1];
          if (val === undefined || val === null) {
            return arg2 || ''; // arg2 acts as default value if provided
          }
          return typeof val === 'object' ? JSON.stringify(val) : String(val);
        }

        case 'body': {
          if (!arg1) return '';
          const val = getNestedValue(requestDetails.body, arg1);
          if (val === undefined || val === null) {
            return arg2 || '';
          }
          return typeof val === 'object' ? JSON.stringify(val) : String(val);
        }

        case 'header': {
          if (!arg1) return '';
          // Express headers are lowercase, let's look case-insensitively
          const searchKey = arg1.toLowerCase();
          const actualKey = Object.keys(requestDetails.headers).find(
            (k) => k.toLowerCase() === searchKey
          );
          const val = actualKey ? requestDetails.headers[actualKey] : undefined;
          if (val === undefined || val === null) {
            return arg2 || '';
          }
          return String(val);
        }

        case 'routeParam':
        case 'param': {
          if (!arg1) return '';
          const val = requestDetails.params[arg1];
          if (val === undefined || val === null) {
            return arg2 || '';
          }
          return String(val);
        }

        case 'uuid': {
          // Standard UUID v4 generator
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
        }

        case 'randomInt': {
          const min = num1 !== undefined ? parseInt(num1, 10) : (arg1 !== undefined ? parseInt(arg1, 10) : 0);
          const max = num2 !== undefined ? parseInt(num2, 10) : (arg2 !== undefined ? parseInt(arg2, 10) : 100);
          if (isNaN(min) || isNaN(max)) return '0';
          const rand = Math.floor(Math.random() * (max - min + 1)) + min;
          return String(rand);
        }

        case 'date': {
          const date = new Date();
          if (arg1 === 'iso') return date.toISOString();
          if (arg1 === 'utc') return date.toUTCString();
          if (arg1 === 'time') return date.toLocaleTimeString();
          return date.toLocaleDateString();
        }

        default:
          return match; // return original string if command is unknown
      }
    } catch (err) {
      console.error('Error parsing template tag:', match, err);
      return '';
    }
  });
}
