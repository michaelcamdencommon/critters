const pg = require("./index");

var r = new pg({
	additionalMatchers: [/\.btn-/, /\#site-main/, /\.mobile-hidden/],
	additionalCss: `
.fixed {
	position: fixed;
}
	`,
});

const contents = `
@media screen and (max-width: 80px) {
	.mobile-hidden {
		display: none;
	}
}
@media screen and (max-width: 99px) {
	p {
		font-size: 10px;
	}
}
@media screen and (max-width: 100px) {
  .bar {
    color: red;
  }
}
.baz {
  color: orange;
}
@font-face {
  font-family: 'Apercu Pro';
  src: url('/fonts/apercu_regular_pro.woff2') format('woff2'),
    url('/fonts/apercu_regular_pro.woff') format('woff'),
    url('/fonts/apercu_regular_pro.otf') format('opentype');
  font-weight: 300;
  font-style: normal;
  font-display: swap;
}
.bizzy {
  font-family: 'Apercu Pro';
}
html {
 font-family: 'Apercu Pro'; 
}
html, body {
  padding: 0;
}
a, a:hover, a.selected {
  color: red;
}

b.selected, b {
  color: blue;
}

.g {
	font: arial 12px;
}

#site-main {
	font-size: 1px;
}

.btn-red {
	border: red;
}

.btn-large {
	transform: scale(10);
}

.mobile-hidden {
	display: none;
}
`;

const compilation = {
	assets: {},
};

r.processSheet({
	contents,
	compilation,
	file: "foo",
});

r.minifyCritical(compilation);

console.log(compilation.assets["foo.critical"].source().toString());
