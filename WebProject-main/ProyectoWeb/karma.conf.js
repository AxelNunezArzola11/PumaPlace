// Karma configuration for `ng test` (was missing; the suite could not run).
// Headless Chrome; single-run in CI via `ng test --watch=false`.
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      jasmine: {},
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/proyecto-web'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['ChromeHeadlessNoSandbox'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          `--user-data-dir=${process.env.CHROME_USER_DATA_DIR || '/tmp/chrome-karma'}`,
        ],
      },
    },
    restartOnFileChange: true,
  });
};
