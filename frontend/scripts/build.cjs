process.env.NG_BUILD_SASS_EMBEDDED = 'false';
process.argv = [process.argv[0], 'ng', 'build', ...process.argv.slice(2)];
require('../node_modules/@angular/cli/bin/ng.js');
