import { GulpTask } from 'gulp-core-build';
import gulpType = require('gulp');
/* tslint:disable:typedef */
const cached = require('gulp-cache');
/* tslint:enable:typedef */
import through2 = require('through2');
import gutil = require('gulp-util');
import tslint = require('tslint');
import { merge } from 'lodash';
import md5 = require('md5');
import * as path from 'path';
import * as lintTypes from 'tslint/lib/lint';
import * as ts from 'typescript';

export interface ITSLintTaskConfig {
  /**
   * A TsLint configuration objects
   */
  lintConfig?: any; /* tslint:disable-line */

  /**
   * Temporary flag, do not use
   */
  useOldConfig?: boolean;

  /**
   * Directories to search for custom linter rules
   */
  rulesDirectory?: string | string[];

  /**
   * An array of files which the linter should analyze
   */
  sourceMatch?: string[];

  /**
   * A function which reports errors to the proper location. Defaults to using the base GulpTask's
   * this.fileError() function.
    */
  reporter?: (result: lintTypes.LintResult, file: gutil.File, options: ITSLintTaskConfig) => void;

  /**
   * If true, displays warnings as errors. This flag has no effect if the reporter function is
   * overriden. Defaults to `false`.
   */
  displayAsWarning?: boolean;

  /**
   * If true, the lintConfig rules which were previously set will be removed. This flag is useful
   * for ensuring that there are no rules activated from previous calls to setConfig(). Default is 'false'.
   */
  removeExistingRules?: boolean;

  /**
   * If false, does not use a default tslint configuration as the basis for creating the list of active rules.
   * Defaults to 'true'
   */
  useDefaultConfigAsBase?: boolean;
}

export class TSLintTask extends GulpTask<ITSLintTaskConfig> {
  public name: string = 'tslint';
  public taskConfig: ITSLintTaskConfig = {
    // lintConfig: require('../lib/defaultTslint.json'),
    lintConfig: {},
    reporter: (result: lintTypes.LintResult, file: gutil.File, options: ITSLintTaskConfig): void => {
      for (const failure of result.failures) {
        const pathFromRoot: string = path.relative(this.buildConfig.rootPath, file.path);

        const start: ts.LineAndCharacter = failure.getStartPosition().getLineAndCharacter();
        if (this.taskConfig.displayAsWarning) {
          this.fileWarning(
            pathFromRoot,
            start.line + 1,
            start.character + 1,
            failure.getRuleName(),
            failure.getFailure());
        } else {
          this.fileError(
            pathFromRoot,
            start.line + 1,
            start.character + 1,
            failure.getRuleName(),
            failure.getFailure());
        }
      }
    },
    rulesDirectory: ((): string[] => {
      const msCustomRulesMain: string = require.resolve('tslint-microsoft-contrib');
      const msCustomRulesDirectory: string = path.dirname(msCustomRulesMain);
      return tslint.getRulesDirectories([ msCustomRulesDirectory ], __dirname);
    })(),
    sourceMatch: [
      'src/**/*.ts',
      'src/**/*.tsx'
    ],
    useOldConfig: false,
    removeExistingRules: false,
    useDefaultConfigAsBase: true
  };

  /* tslint:disable:no-any */
  private _lintRules: any = undefined;
  /* tslint:enable:no-any */

  public setConfig(config: ITSLintTaskConfig): void {
    // If the removeExistingRules flag is set, clear out any existing rules
    if (config.removeExistingRules &&
        this.taskConfig &&
        this.taskConfig.lintConfig) {
      delete this.taskConfig.lintConfig.rules;
      delete config.removeExistingRules;
    }

    super.setConfig(config);
  }

  public executeTask(gulp: gulpType.Gulp): NodeJS.ReadWriteStream {
    const taskScope: TSLintTask = this;

    return gulp.src(this.taskConfig.sourceMatch)
      .pipe(cached(
        through2.obj(function(
          file: gutil.File,
          encoding: string,
          callback: (encoding?: string, file?: gutil.File) => void): void {
          taskScope.logVerbose(file.path);

          // Lint the file
          if (file.isNull()) {
            return callback(undefined, file);
          }

          // Stream is not supported
          if (file.isStream()) {
            this.emit('error', new gutil.PluginError(this.name, 'Streaming not supported'));
            return callback();
          }

          const options: lintTypes.ILinterOptions = {
            configuration: taskScope._loadLintRules(),
            formatter: 'json',
            formattersDirectory: undefined, // not used, use reporters instead
            rulesDirectory: taskScope.taskConfig.rulesDirectory || []
          };

          const tslintOutput: tslint = new tslint(file.relative, file.contents.toString('utf8'), options);
          /* tslint:disable:no-string-literal */
          const result: lintTypes.LintResult = file['tslint'] = tslintOutput.lint();
          /* tslint:enable:no-string-literal */

          if (result.failureCount > 0) {
            taskScope.taskConfig.reporter(result, file, taskScope.taskConfig);
          }

          this.push(file);
          callback();
        }), {
          // Scope the cache to a combination of the lint rules and the build path
          name: md5(
            tslint.VERSION + JSON.stringify(taskScope._loadLintRules()) +
            taskScope.name + taskScope.buildConfig.rootPath),
          // What on the result indicates it was successful
          success: (jshintedFile: gutil.File): boolean => {
            /* tslint:disable:no-string-literal */
            return jshintedFile['tslint'].failureCount === 0;
            /* tslint:enable:no-string-literal */
          },
          // By default, the cache attempts to store the value of the objects in the stream
          // For this task, this is over-engineering since we never need to store anything extra.
          value: (file: gutil.File): Object => {
            return {
              path: file.path
            };
          }
        }
      ));
  }
  /* tslint:disable:no-any */
  private _loadLintRules(): any {
    if (!this._lintRules) {
      const defaultConfig: any =
        /* tslint:enable:no-any */
        this.taskConfig.useDefaultConfigAsBase
          ? (this.taskConfig.useOldConfig
            ? require('./defaultTslint_oldRules.json')
            : require('./defaultTslint.json'))
          : {};
      this._lintRules = merge(defaultConfig, this.taskConfig.lintConfig || {});
    }
    return this._lintRules;
  }
}
