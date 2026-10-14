/**
 * F5 — template helper cheat-sheet data.
 *
 * The snippets mirror the mock engine's helper set 1:1 (Mockoon-parity,
 * DESIGN §2.2). Any `{{faker.…}}` path from @faker-js/faker@8.4.1 also works
 * directly (passthrough) — these are just the common ones.
 */

export interface HelperEntry {
  /** Exact snippet to insert at the caret. */
  snippet: string;
  /** One-line description shown in the picker. */
  description: string;
}

export interface HelperGroup {
  id: string;
  label: string;
  entries: HelperEntry[];
}

export const HELPER_GROUPS: HelperGroup[] = [
  {
    id: 'request',
    label: 'Request',
    entries: [
      { snippet: '{{url}}', description: 'Full request URL' },
      { snippet: '{{baseUrl}}', description: 'Scheme + host (+ port)' },
      { snippet: '{{hostname}}', description: 'Host name' },
      { snippet: '{{method}}', description: 'HTTP method (uppercase)' },
      { snippet: '{{ip}}', description: 'Client IP address' },
      { snippet: '{{requestNumber}}', description: '1-based per-route request counter' },
      { snippet: '{{queryParam "name"}}', description: 'Query string value by name' },
      { snippet: '{{urlParam "name"}}', description: 'Path parameter value by name' },
      { snippet: '{{header "name"}}', description: 'Request header value (case-insensitive)' },
      { snippet: '{{cookie "name"}}', description: 'Cookie value by name' },
      { snippet: '{{body "path.to.value"}}', description: 'Parsed (JSON) body value by path' },
      { snippet: '{{bodyRaw}}', description: 'Raw request body as string' },
    ],
  },
  {
    id: 'data',
    label: 'Data buckets & globals',
    entries: [
      { snippet: '{{data "bucket" "path"}}', description: 'Data bucket value by name + path' },
      { snippet: '{{dataRaw "bucket" "path"}}', description: 'Raw (unparsed) bucket value' },
      { snippet: '{{setData "bucket" "path" "set" value}}', description: 'Mutate a bucket (set, push, increment, decrement, invert)' },
      { snippet: '{{globalVar "name"}}', description: 'Global variable value' },
      { snippet: '{{setVar "name" value}}', description: 'Set a global variable, returns the new value' },
    ],
  },
  {
    id: 'faker',
    label: 'Faker (random data)',
    entries: [
      { snippet: '{{faker.person.fullName}}', description: 'Random full name' },
      { snippet: '{{faker.person.firstName}}', description: 'Random first name' },
      { snippet: '{{faker.person.lastName}}', description: 'Random last name' },
      { snippet: '{{faker.company.name}}', description: 'Random company name' },
      { snippet: '{{faker.internet.email}}', description: 'Random e-mail' },
      { snippet: '{{faker.internet.userName}}', description: 'Random user name' },
      { snippet: '{{faker.internet.domainName}}', description: 'Random domain' },
      { snippet: '{{faker.internet.url}}', description: 'Random URL' },
      { snippet: '{{faker.internet.ipv4}}', description: 'Random IPv4 address' },
      { snippet: '{{faker.internet.ipv6}}', description: 'Random IPv6 address' },
      { snippet: '{{faker.location.city}}', description: 'Random city' },
      { snippet: '{{faker.location.street}}', description: 'Random street name' },
      { snippet: '{{faker.location.country}}', description: 'Random country' },
      { snippet: '{{faker.location.countryCode}}', description: 'Random 2-letter country code' },
      { snippet: '{{faker.location.zipCode}}', description: 'Random zip code' },
      { snippet: '{{faker.location.latitude}}', description: 'Random latitude' },
      { snippet: '{{faker.location.longitude}}', description: 'Random longitude' },
      { snippet: '{{faker.phone.number}}', description: 'Random phone number' },
      { snippet: '{{faker.date.past}}', description: 'Random past date (ISO)' },
      { snippet: '{{faker.date.future}}', description: 'Random future date (ISO)' },
      { snippet: '{{faker.number.int}}', description: 'Random integer' },
      { snippet: '{{faker.number.float}}', description: 'Random float' },
      { snippet: '{{faker.string.uuid}}', description: 'Random UUID' },
      { snippet: '{{faker.string.alpha}}', description: 'Random alphabetic string' },
      { snippet: '{{faker.string.numeric}}', description: 'Random numeric string' },
      { snippet: '{{faker.lorem.words}}', description: 'Random words' },
      { snippet: '{{faker.lorem.sentence}}', description: 'Random sentence' },
      { snippet: '{{faker.color.rgb}}', description: 'Random RGB color' },
      { snippet: '{{faker.database.mongodbObjectId}}', description: 'Random MongoDB ObjectId' },
      { snippet: '{{faker.helpers.arrayElement ["a", "b"]}}', description: 'Random element from a list' },
    ],
  },
  {
    id: 'aliases',
    label: 'Shortcuts',
    entries: [
      { snippet: '{{uuid}}', description: 'UUID v4 (shortcut)' },
      { snippet: '{{objectId}}', description: 'MongoDB ObjectId (shortcut)' },
      { snippet: '{{email}}', description: 'Random e-mail (shortcut)' },
      { snippet: '{{firstName}}', description: 'Random first name (shortcut)' },
      { snippet: '{{lastName}}', description: 'Random last name (shortcut)' },
      { snippet: '{{company}}', description: 'Random company (shortcut)' },
      { snippet: '{{lorem}}', description: 'Random sentence (shortcut)' },
      { snippet: '{{int}}', description: 'Random integer (shortcut)' },
      { snippet: '{{float}}', description: 'Random float (shortcut)' },
      { snippet: '{{boolean}}', description: 'Random true/false (shortcut)' },
      { snippet: '{{hexColor}}', description: 'Random #rrggbb color (shortcut)' },
      { snippet: '{{ipv4}}', description: 'Random IPv4 (shortcut)' },
      { snippet: '{{ipv6}}', description: 'Random IPv6 (shortcut)' },
      { snippet: '{{city}}', description: 'Random city (shortcut)' },
      { snippet: '{{street}}', description: 'Random street (shortcut)' },
      { snippet: '{{country}}', description: 'Random country (shortcut)' },
      { snippet: '{{countryCode}}', description: 'Random country code (shortcut)' },
      { snippet: '{{phone}}', description: 'Random phone number (shortcut)' },
      { snippet: '{{lat}}', description: 'Random latitude (shortcut)' },
      { snippet: '{{long}}', description: 'Random longitude (shortcut)' },
      { snippet: '{{title}}', description: 'Random title (shortcut)' },
    ],
  },
  {
    id: 'string-math',
    label: 'String & math',
    entries: [
      { snippet: '{{concat "a" "b"}}', description: 'Concatenate arguments' },
      { snippet: '{{split "a,b" ","}}', description: 'Split a string into an array' },
      { snippet: '{{indexOf "hello" "ll"}}', description: 'Index of a substring (-1 if missing)' },
      { snippet: '{{base64 "text"}}', description: 'Base64-encode a string' },
      { snippet: '{{base64Decode "text"}}', description: 'Base64-decode a string' },
      { snippet: '{{substr "text" 0 4}}', description: 'Substring (start, end)' },
      { snippet: '{{replace "text" "a" "b"}}', description: 'Replace first occurrence' },
      { snippet: '{{replaceAll "text" "a" "b"}}', description: 'Replace all occurrences' },
      { snippet: '{{lowercase "TEXT"}}', description: 'Lower-case a string' },
      { snippet: '{{uppercase "text"}}', description: 'Upper-case a string' },
      { snippet: '{{padStart "7" 3 "0"}}', description: 'Pad the start to a length' },
      { snippet: '{{padEnd "7" 3 "0"}}', description: 'Pad the end to a length' },
      { snippet: '{{len [1, 2, 3]}}', description: 'Length of an array or string' },
      { snippet: '{{slice [1, 2, 3] 0 2}}', description: 'Slice an array (start, end)' },
      { snippet: '{{join [1, 2, 3] "-"}}', description: 'Join an array with a separator' },
      { snippet: '{{includes "hello" "ell"}}', description: 'Does a string/array contain a value' },
      { snippet: '{{parseInt "42"}}', description: 'Parse a string to an integer' },
      { snippet: '{{toFixed 3.14159 2}}', description: 'Round a float to fixed decimals' },
      { snippet: '{{round 3.6}}', description: 'Round to nearest integer' },
      { snippet: '{{add 1 2}}', description: 'Add two numbers' },
      { snippet: '{{subtract 5 2}}', description: 'Subtract two numbers' },
      { snippet: '{{multiply 3 4}}', description: 'Multiply two numbers' },
      { snippet: '{{divide 8 2}}', description: 'Divide two numbers' },
      { snippet: '{{modulo 10 3}}', description: 'Modulo (remainder)' },
      { snippet: '{{ceil 3.2}}', description: 'Round up' },
      { snippet: '{{floor 3.8}}', description: 'Round down' },
    ],
  },
  {
    id: 'structure',
    label: 'Logic & structure',
    entries: [
      { snippet: '{{#if}}…{{/if}}', description: 'Conditional (built-in)' },
      { snippet: '{{#each (array "a" "b")}}…{{/each}}', description: 'Iterate (built-in)' },
      { snippet: '{{oneOf "a" "b" "c"}}', description: 'Pick one random argument' },
      { snippet: '{{someOf 2 "a" "b" "c"}}', description: 'Pick N random arguments' },
      { snippet: '{{repeat 3}}…{{/repeat}}', description: 'Repeat a block N times' },
      { snippet: '{{#switch "value"}} {{case "value"}}…{{default}}… {{/switch}}', description: 'Switch/case on a value' },
      { snippet: '{{sort [3, 1, 2]}}', description: 'Sort an array (or "desc")' },
      { snippet: '{{reverse [1, 2, 3]}}', description: 'Reverse an array' },
      { snippet: '{{sortBy items "prop"}}', description: 'Sort object array by property' },
      { snippet: '{{filter items {"prop": "value"}}}', description: 'Filter array by property criteria' },
      { snippet: '{{array "a" "b"}}', description: 'Build an array from arguments' },
      { snippet: '{{stringify value}}', description: 'Pretty-print a value as JSON' },
      { snippet: '{{now}}', description: 'Current time (ISO)' },
      { snippet: '{{eq "a" "a"}}', description: 'Equality test (built-in)' },
    ],
  },
];

/** Flat list for search (group label prefixed in the picker UI). */
export const ALL_HELPER_ENTRIES: (HelperEntry & { groupLabel: string })[] = HELPER_GROUPS.flatMap(
  (group) => group.entries.map((entry) => ({ ...entry, groupLabel: group.label })),
);
