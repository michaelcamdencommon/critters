This is a fork of the critter webpack plugin::

## critters-webpack-plugin [![npm](https://img.shields.io/npm/v/critters-webpack-plugin.svg?style=flat)](https://www.npmjs.org/package/critters-webpack-plugin)

This hooks into the afterEmit hook of the build to find compiled CSS files, then run the critical processor on them, and write the result back out as `${file}.critical`. It is then left up to you to merge the critical CSS back into your application.

## Why do this?

Inlining critical CSS improves user experience by reducing the number of blocking calls that occur when rendering stylesheets. Thus far, all of the critical tools I've found operate on the assumption that the application is rendering static HTML. My application is server side rendered, I have no HTML files that are being produced so I needed a solution that will produce this CSS at render time. 

Here is an example of how I do it with nextjs. In this case we can extend the Head component to find additional critical css and render it.

```_document.js

import React from 'react';
import Document, { Head, Main, NextScript } from 'next/document';
import fs from 'fs';

class MyHead extends Head {
  getCssLinks() {
    const { assetPrefix, files } = this.context._documentProps;
    if (!files || files.length === 0) {
      return null;
    }

    return files.map(file => {
      // Only render .css files here
      if (!/\.css$/.exec(file)) {
        return null;
      }
      // Attempt to find a sibling `.critical` css file to load, if found inject it as a style
      try {
        const criticalContent = fs.readFileSync(`.next/${file}.critical`, 'utf8');
        return (
          <>
            <style>{criticalContent.replace(new RegExp("&quot;", 'g'), '"')}</style>
            <link
              key={file}
              rel="stylesheet"
              media="screen"
              nonce={this.props.nonce}
              href={`${assetPrefix}/_next/${file}`}
            />
          </>
        );
      } catch (e) {}

      // Otherwise render the link normally
      return (
        <link
          key={file}
          rel="stylesheet"
          media="screen"
          nonce={this.props.nonce}
          href={`${assetPrefix}/_next/${file}`}
        />
      );
    });
  }
}
```
