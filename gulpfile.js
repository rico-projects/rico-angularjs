"use strict";

require('babel-register');
var gulp = require('gulp');
var $ = require('gulp-load-plugins')();

var browserify = require('browserify');
var del = require('del');
var assign = require('lodash.assign');
var buffer = require('vinyl-buffer');
var glob = require('glob');
var source = require('vinyl-source-stream');
var watchify = require('watchify');

gulp.task('clean', function() {
    del(['dist']);
});

gulp.task('lint', function() {
    return gulp.src(['./src/**/*.js'])
        .pipe($.jshint())
        .pipe($.jshint.reporter('default'))
        .pipe($.jshint.reporter('fail'));
});

gulp.task('verify', ['lint']);

var mainBundler = browserify(assign({}, watchify.args, {
    entries: './src/rico-angular.js',
    debug: true
}));

function rebundle(bundler) {
    return bundler
        .transform('babelify')
        .bundle()
        .on('error', $.util.log.bind($.util, 'Browserify Error'))
        .pipe(source('rico-angular.js'))
        .pipe($.derequire())
        .pipe(gulp.dest('./dist'))
        .pipe(buffer())
        .pipe($.rename({extname: '.min.js'}))
        .pipe($.sourcemaps.init({loadMaps: true}))
        .pipe($.uglify())
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest('./dist'));
}

gulp.task('build', ['clean','verify'], function() {
    return rebundle(mainBundler);
});

var Server = require('karma').Server;

gulp.task('watch', function() {
    gulp.watch(['src/**'], ['lint']);

    var watchedMainBundler = watchify(mainBundler);
    watchedMainBundler.on('update', function() {rebundle(watchedMainBundler)});
});

gulp.task('default', ['verify', 'build', 'watch']);

function rebundleTest(bundler) {
    return bundler
        .transform('babelify')
        .bundle()
        .on('error', $.util.log.bind($.util, 'Browserify Error'))
        .pipe(source('test-bundle.js'))
        .pipe(buffer())
        .pipe($.sourcemaps.init({loadMaps: true}))
        .pipe($.sourcemaps.write('./'))
        .pipe(gulp.dest('./test/build'))
}

var testBundler = browserify(assign({}, watchify.args, {
    entries: glob.sync('./test/src/**/test-*.js'),
    debug: true
}));

gulp.task('build-test', function () {
    return rebundleTest(testBundler);
});

gulp.task('ci-test', ['build-test'], function (done) {
    new Server({
        configFile: __dirname + '/karma.conf.js',
        reporters: ['coverage'],
        coverageReporter: {
            reporters: [
                {type: 'lcovonly', subdir: '.'}
            ]
        },
        singleRun: true
    }, done).start();
});

gulp.task('ci', ['ci-test']);

// START: Saucelabs

function createSauceLabsTestStep(customLaunchers, browsers, done) {
    return function () {
        new Server({
                configFile: __dirname + '/karma.conf.js',
                customLaunchers: customLaunchers,
                browsers: browsers,
                reporters: ['saucelabs'],
                singleRun: true
            }
            ,function(result){
                if(result === 0){
                    done();
                } else {
                    done('Karma test failed: '+result);
                }
            }).start();
    }
}

function createSauceLabsTestPipe(customLaunchers, step) {
    // We cannot run too many instances at Sauce Labs in parallel, thus we need to run it several times
    // with only a few environments set
    var numSauceLabsVMs = 5;
    var allBrowsers = Object.keys(customLaunchers);

    while (allBrowsers.length > 0) {
        var browsers = [];
        for (var i = 0; i < numSauceLabsVMs && allBrowsers.length > 0; i++) {
            browsers.push(allBrowsers.shift());
        }

        step = createSauceLabsTestStep(customLaunchers, browsers, step);
    }

    step();
}

gulp.task('saucelabs', ['build-test'], function (done) {
    var customLaunchers = require('./sauce.launchers.js').browsers;
    return createSauceLabsTestPipe(customLaunchers, done);
});
