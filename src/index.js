const sources = require("webpack-sources");
const prettyBytes = require("pretty-bytes");
const log = require("webpack-log");
const flatten = require("lodash/flatten");
const forEach = require("lodash/forEach");
const map = require("lodash/map");
const postcss = require("postcss");
const cssnano = require("cssnano");
const { tap } = require("./util");

// Used to annotate this plugin's hooks in Tappable invocations
const PLUGIN_NAME = "cmn-extract-critical-css-webpack-plugin";

module.exports = class ExtractCriticalCss {
  constructor(options) {
    this.options = Object.assign(
      {
        logLevel: "info",
        additionalCss: "", // Any additional css to add to the critical file
        additionalMatchers: [], // List of regular expressions to match against selectors to include in the critical file
      },
      options || {}
    );

    this.logger = log({
      name: "Extract Critical CSS",
      unique: true,
      level: this.options.logLevel,
    });
  }

  /**
   * Invoked by Webpack during plugin initialization
   */
  apply(compiler) {
    // hook into the compiler to get a Compilation instance...
    tap(compiler, "emit", PLUGIN_NAME, true, (compilation, cb) => {
      this.process(compilation, cb);
    });
  }

  process(compilation, cb) {
    const stylesheets = Object.keys(compilation.assets).filter((file) =>
      file.match(/\.css$/)
    );

    if (!stylesheets.length) {
      this.logger.info("No stylesheets found in compilation");
      cb(null, {});
      return;
    }

    this.logger.info(`Found ${stylesheets.length} sheets in compilation`);

    stylesheets.forEach((file) => {
      const asset = compilation.assets[file];
      const contents = asset.source();

      this.processSheet({
        contents,
        file,
        compilation,
      });
    });

    this.minifyCritical(compilation)
      .then(() => {
        cb(null, {});
      })
      .catch((e) => {
        cb(e);
      });
  }

  processSheet({ contents, file, compilation }) {
    const sheetAst = postcss.parse(contents);
    const criticalAst = postcss.parse("");

    const fontDefinitions = [];
    const elementRules = [];
    const fontRules = [];
    const additionalRules = [];

    // Walk the sheet rules and pull out critical css
    sheetAst.walk((node) => {
      switch (node.type) {
        // Find any element selectors
        case "rule":
          const anyElementMatches = node.selector
            .split(",")
            .find((s) => s.match(/^[a-z0-9\*]/i));

          if (anyElementMatches) {
            // Capture media query + selector
            if (
              node.parent &&
              node.parent.type === "atrule" &&
              node.parent.name === "media"
            ) {
              elementRules.push(node.parent.remove());
            } else {
              elementRules.push(node.remove());
            }
          }

          if (
            this.options.additionalMatchers &&
            this.options.additionalMatchers.length
          ) {
            forEach(this.options.additionalMatchers, (matcher) => {
              const anyMatches = node.selector
                .split(",")
                .find((s) => s.match(matcher));

              if (anyMatches) {
                if (node.parent && node.parent.type !== "root") {
                  additionalRules.push(node.parent.remove());
                } else {
                  additionalRules.push(node.remove());
                }
              }
            });
          }

          break;
        // Find any @font-face definitions
        case "atrule":
          if (node.name && node.name === "font-face") {
            fontDefinitions.push(node.remove());
          }

          break;
      }
    });

    const criticalRules = flatten([
      fontDefinitions,
      elementRules,
      additionalRules,
    ]);

    criticalRules.forEach((r) => {
      criticalAst.append(r);
    });

    let criticalSheet = criticalAst.toString();
    const mainSheet = sheetAst.toString();

    if (!criticalSheet.length) {
      this.logger.info("No critical css extracted");
      return;
    }

    // Inject additional css after calculation
    if (this.options.additionalCss && this.options.additionalCss.length) {
      criticalSheet += this.options.additionalCss;
    }

    this.logger.info(
      "\u001b[32mInlined " + prettyBytes(criticalSheet.length) + ".\u001b[39m"
    );

    // Update the stylesheet in the compilation (also updates the sourcemap)
    compilation.assets[file] = new sources.LineToLineMappedSource(
      mainSheet,
      file,
      contents
    );

    // Append the new .critical asset
    compilation.assets[`${file}.critical`] = {
      source: function() {
        return Buffer.from(criticalSheet, "utf-8");
      },
      size: function() {
        return criticalSheet.length;
      },
    };
  }

  minifyCritical(compilation) {
    return Promise.all(
      map(compilation.assets, async (asset, name) => {
        if (name.match(/\.critical$/i)) {
          const src = asset.source().toString();
          try {
            const minifiedSource = await cssnano.process(src, {
              from: undefined,
            });

            compilation.assets[name] = {
              source: function() {
                return Buffer.from(minifiedSource.css, "utf-8");
              },
              size: function() {
                return minifiedSource.css.length;
              },
            };
          } catch (e) {}
        }
      })
    );
  }
};
