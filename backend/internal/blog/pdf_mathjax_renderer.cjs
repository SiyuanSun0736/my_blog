const fs = require("fs");
const path = require("path");

const mathJaxDir = String(process.env.BLOG_PDF_MATHJAX_DIR || "").trim();
if (!mathJaxDir) {
	process.stderr.write("BLOG_PDF_MATHJAX_DIR is required\n");
	process.exit(1);
}

const requireFromNodeModules = (relativePath) => require(path.join(mathJaxDir, relativePath));
const requireFromMathJax = (relativePath) => require(path.join(mathJaxDir, "mathjax-full", relativePath));

const { Resvg } = requireFromNodeModules("@resvg/resvg-js");
const { mathjax } = requireFromMathJax("js/mathjax.js");
const { TeX } = requireFromMathJax("js/input/tex.js");
const { SVG } = requireFromMathJax("js/output/svg.js");
const { liteAdaptor } = requireFromMathJax("js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = requireFromMathJax("js/handlers/html.js");
const { AllPackages } = requireFromMathJax("js/input/tex/AllPackages.js");

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({ packages: AllPackages });
const svg = new SVG({ fontCache: "none", displayAlign: "left" });
const html = mathjax.document("", { InputJax: tex, OutputJax: svg });

const inputText = fs.readFileSync(0, "utf8").trim();
if (!inputText) {
	process.stdout.write(JSON.stringify({ error: "render payload is required" }));
	process.exit(0);
}

let input;
try {
	input = JSON.parse(inputText);
} catch (error) {
	process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
	process.exit(0);
}

const expression = String(input.expression || "").trim();
const display = Boolean(input.display);
if (!expression) {
	process.stdout.write(JSON.stringify({ error: "expression is required" }));
	process.exit(0);
}

try {
	const container = html.convert(expression, { display });
	const svgNode = adaptor.firstChild(container);
	if (!svgNode) {
		throw new Error("MathJax returned an empty SVG node");
	}

	const svgMarkup = adaptor.outerHTML(svgNode);
	const resvg = new Resvg(svgMarkup, {
		fitTo: { mode: "zoom", value: 2 },
		background: "rgba(0,0,0,0)",
		font: { loadSystemFonts: false },
	});
	const pngBuffer = resvg.render().asPng();

	process.stdout.write(JSON.stringify({ png: pngBuffer.toString("base64") }));
} catch (error) {
	process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
}