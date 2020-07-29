const pg = require("./index");
const fs = require("fs");

const css = fs.readFileSync("./test.css");

var r = new pg({
	additionalMatchers: [/\.btn-/, /\#site-main/, /\.mobile-hidden/],
});

const compilation = {
	assets: {
		"foo.css": {
			source: () => css,
			length: () => css.length,
		},
	},
};

// r.processSheet({
// 	contents: css,
// 	compilation,
// 	file: "foo",
// });

// r.minifyCritical(compilation);

r.process(compilation, () => {});

console.log("MAIN", compilation.assets["foo.css"].source().toString());
console.log("CRIT", compilation.assets["foo.css.critical"].source().toString());
