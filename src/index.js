/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */
const sources = require("webpack-sources");
const prettyBytes = require("pretty-bytes");
const fs = require("fs");
const log = require("webpack-log");
const union = require("lodash/union");
const { JSDOM } = require("jsdom");
const { tap } = require("./util");
const { setNodeText } = require("./dom");
const {
  parseStylesheet,
  serializeStylesheet,
  walkStyleRules,
  walkStyleRulesWithReverseMirror,
  markOnly,
  applyMarkedSelectors,
} = require("./css");

// Used to annotate this plugin's hooks in Tappable invocations
const PLUGIN_NAME = "critters-webpack-plugin";

module.exports = class Critters {
  /** @private */
  constructor(options) {
    this.options = Object.assign(
      {
        logLevel: "info",
        externalStylesheets: [],
        fonts: true,
      },
      options || {}
    );

    // Eventually support this
    this.options.pruneSource = true;
    // this.options.pruneSource = this.options.pruneSource !== false;
    this.urlFilter = this.options.filter;
    if (this.urlFilter instanceof RegExp) {
      this.urlFilter = this.urlFilter.test.bind(this.urlFilter);
    }
    this.logger = log({
      name: "Critters",
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
      // tap(compiler, "afterEmit", PLUGIN_NAME, true, (compilation, cb) => {
      const stylesheets = Object.keys(compilation.assets).filter((file) =>
        file.match(/\.css$/)
      );

      if (!stylesheets.length) {
        this.logger.warn("No stylesheets found in compilation");
        cb(null, {});
        return;
      }

      this.logger.info(`Found ${stylesheets.length} sheets in compilation`);

      // console.log(stylesheets);
      // throw new Error("Normal stop");

      Promise.all(
        stylesheets.map(async (file) => {
          const asset = compilation.assets[file];
          // console.log("Asset is ...", asset);
          // throw new Error("Normal stop");

          const contents = asset.source();

          // const contents = await this.readFile(compilation, `.next/${file}`);
          const dom = new JSDOM(
            `<!DOCTYPE html><html lang="en"><head><style type="text/css">${contents}</style></head><body></body></html>`
          );
          const styleEl = dom.window.document.querySelector("style");

          styleEl.$$name = file;
          styleEl.$$asset = asset;
          styleEl.$$assetName = `.next/${file}`;
          styleEl.$$assets = compilation.assets;
          styleEl.$$links = null;

          this.processStyle(styleEl);

          // await this.writeFile(
          //   compilation,
          //   `.next/${file}.critical`,
          //   styleEl.textContent
          // );

          // console.log("After assets...", styleEl.$$assets);
          // throw new Error("Normal stop");
        })
      )
        .then(() => cb(null, {}))
        .catch(cb);
    });
  }

  /**
   * Read the contents of a file from Webpack's input filesystem
   */
  readFile(compilation, filename) {
    const fs = this.fs || compilation.outputFileSystem;
    return new Promise((resolve, reject) => {
      const callback = (err, data) => {
        if (err) reject(err);
        else resolve(data);
      };
      if (fs && fs.readFile) {
        fs.readFile(filename, callback);
      } else {
        require("fs").readFile(filename, "utf8", callback);
      }
    });
  }

  writeFile(compilation, filename, content) {
    const fs = this.fs || compilation.outputFileSystem;
    return new Promise((resolve, reject) => {
      const callback = (err, data) => {
        if (err) reject(err);
        else resolve(data);
      };
      if (fs && fs.writeFile) {
        fs.writeFile(filename, content, callback);
      } else {
        require("fs").writeFile(filename, content, "utf8", callback);
      }
    });
  }

  /**
   * Parse the stylesheet within a <style> element, then reduce it to contain only rules used by the document.
   */
  processStyle(style) {
    if (style.$$reduce === false) return;

    const name = style.$$name ? style.$$name.replace(/^\//, "") : "inline CSS";
    const options = this.options;
    const document = style.ownerDocument;
    const head = document.querySelector("head");
    let keyframesMode = options.keyframes || "critical";
    // we also accept a boolean value for options.keyframes
    if (keyframesMode === true) keyframesMode = "all";
    if (keyframesMode === false) keyframesMode = "none";

    // basically `.textContent`
    let sheet =
      style.childNodes.length > 0 &&
      [].map.call(style.childNodes, (node) => node.nodeValue).join("\n");

    // store a reference to the previous serialized stylesheet for reporting stats
    const before = sheet;

    // Skip empty stylesheets
    if (!sheet) {
      console.log("No sheet");
      return;
    }

    const ast = parseStylesheet(sheet);
    const astInverse = options.pruneSource ? parseStylesheet(sheet) : null;

    // a string to search for font names (very loose)
    let criticalFonts = "";

    const failedSelectors = [];

    const criticalKeyframeNames = [];

    // Walk all CSS rules, marking unused rules with `.$$remove=true` for removal in the second pass.
    // This first pass is also used to collect font and keyframe usage used in the second pass.
    walkStyleRules(
      ast,
      markOnly((rule) => {
        if (rule.type === "rule") {
          // Filter the selector list down to only those match
          rule.filterSelectors((sel) => {
            // Strip pseudo-elements and pseudo-classes, since we only care that their associated elements exist.
            // This means any selector for a pseudo-element or having a pseudo-class will be inlined if the rest of the selector matches.
            if (sel !== ":root") {
              sel = sel.replace(/(?:>\s*)?::?[a-z-]+\s*(\{|$)/gi, "$1").trim();
            }
            if (!sel) return false;

            try {
              return document.querySelector(sel) != null;
            } catch (e) {
              failedSelectors.push(sel + " -> " + e.message);
              return false;
            }
          });
          // If there are no matched selectors, remove the rule:
          if (rule.selectors.length === 0) {
            return false;
          }

          if (rule.declarations) {
            for (let i = 0; i < rule.declarations.length; i++) {
              const decl = rule.declarations[i];

              // console.log("Rule decl", decl);

              // detect used fonts
              if (decl.property && decl.property.match(/\bfont(-family)?\b/i)) {
                criticalFonts += " " + decl.value;
              }

              // console.log("Found critical fonts", criticalFonts);

              // detect used keyframes
              if (
                decl.property === "animation" ||
                decl.property === "animation-name"
              ) {
                // @todo: parse animation declarations and extract only the name. for now we'll do a lazy match.
                const names = decl.value.split(/\s+/);
                for (let j = 0; j < names.length; j++) {
                  const name = names[j].trim();
                  if (name) criticalKeyframeNames.push(name);
                }
              }
            }
          }
        }

        // keep font rules, they're handled in the second pass:
        if (rule.type === "font-face") return;

        // If there are no remaining rules, remove the whole rule:
        const rules = rule.rules && rule.rules.filter((rule) => !rule.$$remove);
        return !rules || rules.length !== 0;
      })
    );

    if (failedSelectors.length !== 0) {
      this.logger.warn(
        `${
          failedSelectors.length
        } rules skipped due to selector errors:\n  ${failedSelectors.join(
          "\n  "
        )}`
      );
    }

    const shouldPreloadFonts =
      options.fonts === true || options.preloadFonts === true;
    const shouldInlineFonts =
      options.fonts !== false && options.inlineFonts === true;

    let preloadedFonts = [];
    let inlineFontRules = [];
    // Second pass, using data picked up from the first
    walkStyleRulesWithReverseMirror(ast, astInverse, (rule) => {
      // remove any rules marked in the first pass
      if (rule.$$remove === true) return false;

      applyMarkedSelectors(rule);

      // prune @keyframes rules
      if (rule.type === "keyframes") {
        if (keyframesMode === "none") return false;
        if (keyframesMode === "all") return true;
        return criticalKeyframeNames.indexOf(rule.name) !== -1;
      }

      // prune @font-face rules
      if (rule.type === "font-face") {
        // inlineFontRules.push(rule);
        return true;

        // console.log("FONT FACE RULE", rule);

        let family, src;
        for (let i = 0; i < rule.declarations.length; i++) {
          const decl = rule.declarations[i];
          if (decl.property === "src") {
            // @todo parse this properly and generate multiple preloads with type="font/woff2" etc
            src = decl.value.match(/url\s*\(\s*(['"]?)(.+?)\1\s*\)/g) || [];
          } else if (decl.property === "font-family") {
            family = decl.value;
          }
        }

        const nextPreloadedFonts = union(preloadedFonts, src);

        if (
          src &&
          src.length &&
          shouldPreloadFonts &&
          nextPreloadedFonts.length > preloadedFonts.length
        ) {
          preloadedFonts = nextPreloadedFonts;
          console.log(`Added ${src} to preloaded fonts`);
          // const preload = document.createElement("link");
          // preload.setAttribute("rel", "preload");
          // preload.setAttribute("as", "font");
          // preload.setAttribute("crossorigin", "anonymous");
          // preload.setAttribute("href", src.trim());
          // head.appendChild(preload);
        }

        // if we're missing info, if the font is unused, or if critical font inlining is disabled, remove the rule:
        if (
          !family ||
          !src ||
          criticalFonts.indexOf(family) === -1 ||
          !shouldInlineFonts
        )
          return false;
      }
    });

    // console.log("Collected fonts", inlineFontRules);

    sheet = serializeStylesheet(ast, {
      compress: this.options.compress !== false,
    }).trim();

    // If all rules were removed, get rid of the style element entirely
    if (sheet.trim().length === 0) {
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
      return;
    }

    let afterText = "";
    if (options.pruneSource) {
      const sheetInverse = serializeStylesheet(astInverse, {
        compress: this.options.compress !== false,
      });
      const asset = style.$$asset;
      if (asset) {
        // if external stylesheet would be below minimum size, just inline everything
        const minSize = this.options.minimumExternalSize;
        if (minSize && sheetInverse.length < minSize) {
          this.logger.info(
            `\u001b[32mInlined all of ${name} (non-critical external stylesheet would have been ${sheetInverse.length}b, which was below the threshold of ${minSize})\u001b[39m`
          );
          setNodeText(style, before);
          // remove any associated external resources/loaders:
          if (style.$$links) {
            for (const link of style.$$links) {
              const parent = link.parentNode;
              if (parent) parent.removeChild(link);
            }
          }
          // delete the webpack asset:
          delete style.$$assets[style.$$assetName];
          return;
        }

        const percent = (sheetInverse.length / before.length) * 100;
        afterText = `, reducing non-inlined size ${percent |
          0}% to ${prettyBytes(sheetInverse.length)}`;
        style.$$assets[style.$$assetName] = new sources.LineToLineMappedSource(
          sheetInverse,
          style.$$assetName,
          before
        );
        console.log("Main css", sheetInverse);
      } else {
        this.logger.warn(
          "pruneSource is enabled, but a style (" +
            name +
            ") has no corresponding Webpack asset."
        );
      }
    }

    // replace the inline stylesheet with its critical'd counterpart
    style.$$assets[`${style.$$assetName}.critical`] = {
      source: function() {
        return Buffer.from(sheet, "utf-8");
      },
      size: function() {
        return sheet.length;
      },
    };

    console.log("Critical sheet", sheet);

    // output stats
    const percent = ((sheet.length / before.length) * 100) | 0;
    this.logger.info(
      "\u001b[32mInlined " +
        prettyBytes(sheet.length) +
        " (" +
        percent +
        "% of original " +
        prettyBytes(before.length) +
        ") of " +
        name +
        afterText +
        ".\u001b[39m"
    );
  }
};
