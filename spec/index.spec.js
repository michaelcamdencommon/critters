const Plugin = require("../src/index");

describe("plugin", () => {
	let compilation;

	beforeEach(() => {
		compilation = {
			assets: {},
		};
	});

	describe("element-selectors", () => {
		const inst = new Plugin();

		it("matches elements", () => {
			const contents = `.foo {} .bar {} p {}`;
			inst.processSheet({
				contents,
				compilation,
				file: "foo",
			});

			expect(
				compilation.assets["foo.critical"]
					.source()
					.toString()
					.trim()
			).toEqual("p {}");
		});

		it("matches elements with media queries", () => {
			const contents = `.foo {} .bar {} @media screen and (max-width:47.9375em) {p {}}`;

			inst.processSheet({
				contents,
				compilation,
				file: "foo",
			});

			expect(
				compilation.assets["foo.critical"]
					.source()
					.toString()
					.trim()
			).toEqual("@media screen and (max-width:47.9375em) {p {}}");
		});
		it("matches elements classNames", () => {
			const contents = `p.foo {}p.bar {}@media screen and (max-width:47.9375em) {p.baz {}}`;

			inst.processSheet({
				contents,
				compilation,
				file: "foo",
			});

			expect(
				compilation.assets["foo.critical"]
					.source()
					.toString()
					.trim()
			).toEqual(contents.trim());
		});
		it("matches elements with psuedoSelectors", () => {
			const contents = `a:hover,a.selected {color: red}`;

			inst.processSheet({
				contents,
				compilation,
				file: "foo",
			});

			expect(
				compilation.assets["foo.critical"]
					.source()
					.toString()
					.trim()
			).toEqual(contents.trim());
		});
		it("matches greedy elements", () => {
			const contents = `* {color: red}`;

			inst.processSheet({
				contents,
				compilation,
				file: "foo",
			});

			expect(
				compilation.assets["foo.critical"]
					.source()
					.toString()
					.trim()
			).toEqual(contents.trim());
		});
	});
	describe("font-face rules", () => {
		const inst = new Plugin();

		it("matches @font-face", () => {
			const fontFace = `
@font-face {
  font-family: 'Apercu Pro';
  src: url('/fonts/apercu_regular_pro.woff2') format('woff2'),
    url('/fonts/apercu_regular_pro.woff') format('woff'),
    url('/fonts/apercu_regular_pro.otf') format('opentype');
  font-weight: 300;
  font-style: normal;
  font-display: swap;
}`;

			const contents = `${fontFace}
.other-rule {}
#another-rule{}`;
			inst.processSheet({
				contents,
				compilation,
				file: "foo",
			});

			expect(
				compilation.assets["foo.critical"]
					.source()
					.toString()
					.trim()
			).toEqual(fontFace.trim());
		});
	});
	describe("additionalCss", () => {
		it("includes additional css", () => {
			const additionalCss = ".foo {color: red}";
			const inst = new Plugin({
				additionalCss,
			});

			const contents = `p {color: blue}`;
			inst.processSheet({
				contents,
				compilation,
				file: "foo",
			});

			expect(
				compilation.assets["foo.critical"]
					.source()
					.toString()
					.trim()
			).toEqual(contents + additionalCss);
		});
	});
	describe("additionalMatchers", () => {
		it("matches additional css selectors", () => {
			const inst = new Plugin({
				additionalMatchers: [/\.btn\-/i],
			});

			const contents = `p {color: blue}.btn-lg {}.btn-sm {}`;
			inst.processSheet({
				contents,
				compilation,
				file: "foo",
			});

			expect(
				compilation.assets["foo.critical"]
					.source()
					.toString()
					.trim()
			).toEqual(contents);
		});
	});
});
