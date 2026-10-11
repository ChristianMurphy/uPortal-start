/*
 * The browser side of layout-checks.ts. These functions run in the page,
 * not in Node: layoutScript() puts their source into one script, so each
 * may use only the DOM and the other functions here.
 */

export type Check =
  | "scroll"
  | "cut-off"
  | "spill"
  | "wrap"
  | "collapse"
  | "spacing";

export interface Problem {
  check: Check;
  node: string;
  detail: string;
}

declare global {
  interface Window {
    upLayoutMeasure?: () => Problem[];
  }
}

function tidy(text: string): string {
  return text.replaceAll(/\d+/g, "#");
}

/*
 * "#id", or "tag.class.class" with its first three classes. An id with
 * digits in it (a layout node id) gets the classes too, because the digits
 * become "#" and the classes (a portlet's fname) tell such elements apart.
 */
function ownName(element: Element): string {
  const classes = [...element.classList]
    .filter(
      (name) =>
        !/^(active|show|open|collapsed|hover|first|last|selected|disabled|fl-tabs-active)$/.test(
          name,
        ),
    )
    .slice(0, 3)
    .map((name) => `.${name}`)
    .join("");
  if (element.id === "") return element.tagName.toLowerCase() + classes;
  return /\d/.test(element.id) ? `#${element.id}${classes}` : `#${element.id}`;
}

/*
 * Its id, or the nearest id above it and its own tag and classes. Inside a
 * shadow root the name starts with the host's, then " >>> ", as axe writes it.
 */
function nameOf(element: Element | undefined): string {
  if (element === undefined) return "document";
  const anchor =
    element.id === "" ? element.parentElement?.closest("[id]") : undefined;
  const local = anchor
    ? `${ownName(anchor)} ${ownName(element)}`
    : ownName(element);
  const root = element.getRootNode();
  const host = root instanceof globalThis.ShadowRoot ? root.host : undefined;
  return tidy(host ? `${nameOf(host)} >>> ${local}` : local);
}

/* The element's parent, or the host of the shadow root it is in */
function composedParent(element: Element): Element | undefined {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof globalThis.ShadowRoot ? root.host : undefined;
}

/* Whether `inner` is `outer` or inside it, across shadow roots */
function within(outer: Element, inner: Element): boolean {
  for (
    let current: Element | undefined = inner;
    current;
    current = composedParent(current)
  ) {
    if (current === outer) return true;
  }
  return false;
}

/* The element's children, and those of its shadow root */
function composedChildren(element: Element): Element[] {
  return [...element.children, ...(element.shadowRoot?.children ?? [])];
}

/* Every element under the root, including inside open shadow roots */
function composedElements(root: Element): Element[] {
  const found: Element[] = [];
  for (const child of composedChildren(root)) {
    found.push(child, ...composedElements(child));
  }
  return found;
}

function problem(
  check: Check,
  element: Element | undefined,
  detail: string,
): Problem {
  return { check, node: nameOf(element), detail };
}

/* Hidden for everyone but screen readers: clipped, as Bootstrap's visually-hidden does */
function isVisuallyHidden(style: CSSStyleDeclaration): boolean {
  const positioned =
    style.position === "absolute" || style.position === "fixed";
  const clip = style.getPropertyValue("clip");
  return (
    (positioned && clip !== "auto" && clip !== "") ||
    style.clipPath.startsWith("inset(50%")
  );
}

function isRendered(element: Element): boolean {
  const style = globalThis.getComputedStyle(element);
  return (
    element.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
    }) && !isVisuallyHidden(style)
  );
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/* The ancestor's padding box, where it clips its content */
function clipBox(ancestor: Element): Box {
  const box = ancestor.getBoundingClientRect();
  const left = box.left + ancestor.clientLeft;
  const top = box.top + ancestor.clientTop;
  return {
    left,
    top,
    right: left + ancestor.clientWidth,
    bottom: top + ancestor.clientHeight,
  };
}

/*
 * The part of the element's box that its ancestors don't clip away. An
 * absolutely positioned box escapes the clipping of ancestors inside its
 * containing block, and a fixed one escapes all of them.
 */
function visibleBox(element: Element): Box {
  const own = element.getBoundingClientRect();
  const box: Box = {
    left: own.left,
    top: own.top,
    right: own.right,
    bottom: own.bottom,
  };
  let position = globalThis.getComputedStyle(element).position;
  for (
    let ancestor = composedParent(element);
    ancestor && position !== "fixed";
    ancestor = composedParent(ancestor)
  ) {
    const style = globalThis.getComputedStyle(ancestor);
    const contains = position !== "absolute" || style.position !== "static";
    if (contains) {
      const clip = clipBox(ancestor);
      if (style.overflowX !== "visible") {
        box.left = Math.max(box.left, clip.left);
        box.right = Math.min(box.right, clip.right);
      }
      if (style.overflowY !== "visible") {
        box.top = Math.max(box.top, clip.top);
        box.bottom = Math.min(box.bottom, clip.bottom);
      }
      position = style.position;
    }
  }
  return box;
}

function isShown(element: Element): boolean {
  if (!isRendered(element)) return false;
  const box = visibleBox(element);
  // Moved off the page, above or left of it: also for screen readers only
  const offPage =
    box.right + globalThis.scrollX <= 0 || box.bottom + globalThis.scrollY <= 0;
  return box.right - box.left > 1 && box.bottom - box.top > 1 && !offPage;
}

/* The element's own text nodes that have text */
function ownText(element: Element): Text[] {
  return [...element.childNodes].filter(
    (node): node is Text =>
      node instanceof globalThis.Text && (node.textContent ?? "").trim() !== "",
  );
}

function textRects(text: Text): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(text);
  return [...range.getClientRects()].filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
}

/* Form controls and frames scroll their own content */
function scrollsItself(element: Element): boolean {
  return ["INPUT", "TEXTAREA", "SELECT", "IFRAME", "svg"].includes(
    element.tagName,
  );
}

function hides(overflow: string): boolean {
  return overflow === "hidden" || overflow === "clip";
}

/* An ellipsis is fine when the full text is also in a title (hover) */
function isTitledEllipsis(
  element: Element,
  style: CSSStyleDeclaration,
): boolean {
  if (style.textOverflow !== "ellipsis") return false;
  const text = (element.textContent ?? "").trim();
  const title = element.closest("[title]")?.getAttribute("title") ?? "";
  return text !== "" && title.includes(text);
}

function cutOffDetail(
  element: Element,
  overX: boolean,
  overY: boolean,
): string {
  const parts: string[] = [];
  if (overX) parts.push(`${element.scrollWidth - element.clientWidth}px wider`);
  if (overY) {
    parts.push(`${element.scrollHeight - element.clientHeight}px taller`);
  }
  return `${parts.join(", ")} than its box`;
}

/* 2 (and 6): a box that hides overflow has more content than it shows */
function cutOffProblems(visible: Element[], check: Check): Problem[] {
  const problems: Problem[] = [];
  for (const element of visible) {
    if (scrollsItself(element)) continue;
    const style = globalThis.getComputedStyle(element);
    const overX =
      hides(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    const overY =
      hides(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    if (!overX && !overY) continue;
    if (overX && !overY && isTitledEllipsis(element, style)) continue;
    problems.push(problem(check, element, cutOffDetail(element, overX, overY)));
  }
  return problems;
}

/*
 * 1: the page is wider than the screen. It scrolls sideways, or, where the
 * body hides overflow as Respondr's does, what is past the edge is cut off.
 * Names the outermost elements that reach past the edge.
 */
function scrollProblems(visible: Element[]): Problem[] {
  const width = document.documentElement.clientWidth;
  const pageWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth,
  );
  if (pageWidth <= width + 1) return [];
  const past = visible.filter(
    (element) => element.getBoundingClientRect().right > width + 1,
  );
  const outermost = past.filter(
    (element) =>
      !past.some((other) => other !== element && within(other, element)),
  );
  if (outermost.length === 0) {
    return [problem("scroll", undefined, `${pageWidth}px wide`)];
  }
  return outermost.map((element) =>
    problem(
      "scroll",
      element,
      `ends at ${Math.round(element.getBoundingClientRect().right)}px of ${width}px`,
    ),
  );
}

function inFlow(element: Element): boolean {
  const { position } = globalThis.getComputedStyle(element);
  return position !== "absolute" && position !== "fixed";
}

/* How far the element's in-flow children and text reach past its sides */
function spillWidth(element: Element): number {
  const box = element.getBoundingClientRect();
  const parts = [
    ...composedChildren(element)
      .filter((child) => isShown(child) && inFlow(child))
      .map((child) => child.getBoundingClientRect()),
    ...ownText(element).flatMap((text) => textRects(text)),
  ];
  const past = parts.map((part) =>
    Math.max(part.right - box.right, box.left - part.left),
  );
  return Math.max(0, ...past);
}

/* 3: content reaches past a box that lets it show */
function spillProblems(visible: Element[]): Problem[] {
  const problems: Problem[] = [];
  for (const element of visible) {
    if (scrollsItself(element)) continue;
    const style = globalThis.getComputedStyle(element);
    if (style.display === "inline" || style.overflowX !== "visible") continue;
    const width = spillWidth(element);
    if (width > 1) {
      problems.push(
        problem(
          "spill",
          element,
          `content ${Math.round(width)}px past its box`,
        ),
      );
    }
  }
  return problems;
}

function overlap(a: Box, b: Box): [number, number] {
  return [
    Math.min(a.right, b.right) - Math.max(a.left, b.left),
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  ];
}

/* The topmost element at a point of the viewport, inside shadow roots too */
function topmostAt(x: number, y: number): Element | undefined {
  let found = document.elementFromPoint(x, y) ?? undefined;
  while (found?.shadowRoot) {
    const inner = found.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === found) break;
    found = inner;
  }
  return found;
}

/* The centre of the box and four points near its edges, in the viewport */
function samplePoints(box: Box): [number, number][] {
  const x = (fraction: number): number =>
    box.left + (box.right - box.left) * fraction;
  const y = (fraction: number): number =>
    box.top + (box.bottom - box.top) * fraction;
  return [
    [x(0.5), y(0.5)],
    [x(0.15), y(0.5)],
    [x(0.85), y(0.5)],
    [x(0.5), y(0.15)],
    [x(0.5), y(0.85)],
  ];
}

/*
 * The controls that are on top at some point of their visible box, so not
 * hidden under other content. Hit testing works only on the screen, so the
 * page scrolls to each control that is off it, then back.
 */
function uncovered(controls: Element[]): Element[] {
  const scroll = { x: globalThis.scrollX, y: globalThis.scrollY };
  const height = globalThis.innerHeight;
  const result: Element[] = [];
  try {
    for (const element of controls) {
      let box = visibleBox(element);
      const middle = (box.top + box.bottom) / 2;
      if (middle < height * 0.25 || middle > height * 0.75) {
        globalThis.scrollBy(0, middle - height / 2);
        box = visibleBox(element);
      }
      const onTop = samplePoints(box).some(([x, y]) => {
        const top = topmostAt(x, y);
        return top !== undefined && within(element, top);
      });
      if (onTop) result.push(element);
    }
  } finally {
    globalThis.scrollTo(scroll.x, scroll.y);
  }
  return result;
}

/* 3: two controls, neither inside the other and neither hidden under other content, overlap */
function overlapProblems(visible: Element[]): Problem[] {
  const controls = uncovered(
    visible.filter((element) =>
      element.matches(
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="link"]',
      ),
    ),
  );
  const items = controls.map((element) => ({
    element,
    box: visibleBox(element),
  }));
  const problems: Problem[] = [];
  for (const [first, a] of items.entries()) {
    for (const [second, b] of items.entries()) {
      if (
        second <= first ||
        within(a.element, b.element) ||
        within(b.element, a.element)
      )
        continue;
      const [x, y] = overlap(a.box, b.box);
      if (x > 2 && y > 2) {
        const size = `${Math.round(x)}x${Math.round(y)}px`;
        problems.push(
          problem(
            "spill",
            a.element,
            `overlaps ${nameOf(b.element)} by ${size}`,
          ),
        );
      }
    }
  }
  return problems;
}

/* The number of lines the element's shown text takes */
function lineCount(element: Element): number {
  const lineHeight =
    Number.parseFloat(globalThis.getComputedStyle(element).lineHeight) || 16;
  const tops = [element, ...composedElements(element)]
    .filter((each) => isShown(each))
    .flatMap((each) => ownText(each))
    .flatMap((text) => textRects(text))
    .map((rect) => rect.top)
    .toSorted((a, b) => a - b);
  const rows: number[] = [];
  for (const top of tops) {
    if (rows.every((row) => Math.abs(row - top) > lineHeight / 2)) {
      rows.push(top);
    }
  }
  return rows.length;
}

/* 4: from 768px of width, one-line controls and labels wrap; from 1024px, the tab bar does */
function wrapProblems(visible: Element[], width: number): Problem[] {
  if (width < 768) return [];
  const problems = visible
    .filter(
      (element) =>
        element.matches(
          'button, .btn, [role="tab"], .nav-link, [role="menuitem"], .dropdown-item, th, label, .badge',
        ) && (element.textContent ?? "").trim() !== "",
    )
    .map((element) => [element, lineCount(element)] as const)
    .filter(([, lines]) => lines > 1)
    .map(([element, lines]) => problem("wrap", element, `${lines} lines`));
  const bar = document.querySelector("#portalNavigationList");
  if (width >= 1024 && bar !== null) {
    const tops = new Set(
      [...bar.children]
        .filter((tab) => isShown(tab))
        .map((tab) => Math.round(tab.getBoundingClientRect().top)),
    );
    if (tops.size > 1) problems.push(problem("wrap", bar, `${tops.size} rows`));
  }
  return problems;
}

/* The width the checks apply to: the viewport's for the page, else the root's own */
function widthOf(root: Element): number {
  return root === document.body
    ? globalThis.innerWidth
    : root.getBoundingClientRect().width;
}

/* Whether something in it would show: text or media, not hidden on purpose */
function hasContent(element: Element): boolean {
  return composedElements(element).some(
    (each) =>
      !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(each.tagName) &&
      (ownText(each).length > 0 || each.matches("img, svg, canvas, iframe")) &&
      isRendered(each),
  );
}

function isLayoutBox(element: Element): boolean {
  return (
    element.matches(
      '.up-portlet-wrapper, .up-portlet-content-wrapper, [id^="region-"], .portal-page-column',
    ) ||
    (element.tagName.includes("-") &&
      element.closest(".up-portlet-content-wrapper") !== null)
  );
}

/* 5: portlets, regions, columns and components with content keep a usable size */
function collapseProblems(all: Element[]): Problem[] {
  const problems: Problem[] = [];
  for (const element of all.filter((each) => isLayoutBox(each))) {
    const style = globalThis.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (!hasContent(element)) continue;
    const box = element.getBoundingClientRect();
    const size = `${Math.round(box.width)}x${Math.round(box.height)}px`;
    const inColumn = element.closest(".portal-page-column") !== null;
    if (box.height < 8 || (inColumn && box.width < 40)) {
      problems.push(problem("collapse", element, `${size} with content`));
    } else if (
      element.matches(".portal-page-column") &&
      element.querySelector(".up-portlet-wrapper") !== null &&
      box.width < 240
    ) {
      problems.push(problem("collapse", element, `column ${size}`));
    }
  }
  return problems;
}

/* 5: images keep their proportions */
function imageProblems(visible: Element[]): Problem[] {
  const problems: Problem[] = [];
  for (const image of visible) {
    if (!(image instanceof globalThis.HTMLImageElement)) continue;
    const { naturalWidth, naturalHeight } = image;
    if (naturalWidth === 0 || naturalHeight === 0) continue;
    const fit = globalThis.getComputedStyle(image).objectFit;
    if (["contain", "cover", "scale-down"].includes(fit)) continue;
    const box = image.getBoundingClientRect();
    const natural = naturalWidth / naturalHeight;
    if (Math.abs(box.width / box.height - natural) / natural > 0.05) {
      const size = `${Math.round(box.width)}x${Math.round(box.height)}px`;
      problems.push(
        problem(
          "collapse",
          image,
          `image ${size}, natural ${naturalWidth}x${naturalHeight}`,
        ),
      );
    }
  }
  return problems;
}

/* WCAG 1.4.12: line height 1.5, paragraph spacing 2em, letter 0.12em, word 0.16em */
function textSpacing(): string {
  return (
    "* { line-height: 1.5 !important; letter-spacing: 0.12em !important;" +
    " word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }"
  );
}

/* Check 2 again, with the text spacing in the document and every shadow root */
function spacingProblems(root: Element, all: Element[]): Problem[] {
  const styles = [
    document.head,
    ...all.flatMap((element) => element.shadowRoot ?? []),
  ].map((parent) => {
    const style = document.createElement("style");
    style.textContent = textSpacing();
    parent.append(style);
    return style;
  });
  try {
    const visible = composedElements(root).filter((element) =>
      isShown(element),
    );
    return cutOffProblems(visible, "spacing");
  } finally {
    for (const style of styles) style.remove();
  }
}

/* Checks 1 to 6 on everything under the root (the page's body by default) */
function measureAll(root: Element = document.body): Problem[] {
  const all = composedElements(root).filter(
    (element) =>
      !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "BR"].includes(
        element.tagName,
      ),
  );
  const visible = all.filter((element) => isShown(element));
  return [
    ...scrollProblems(visible),
    ...cutOffProblems(visible, "cut-off"),
    ...spillProblems(visible),
    ...overlapProblems(visible),
    ...wrapProblems(visible, widthOf(root)),
    ...collapseProblems(all),
    ...imageProblems(visible),
    ...spacingProblems(root, all),
  ];
}

/** A script that defines window.upLayoutMeasure from the functions above */
export function layoutScript(): string {
  const functions = [
    tidy,
    ownName,
    nameOf,
    composedParent,
    within,
    composedChildren,
    composedElements,
    problem,
    isVisuallyHidden,
    isRendered,
    clipBox,
    visibleBox,
    isShown,
    ownText,
    textRects,
    scrollsItself,
    hides,
    isTitledEllipsis,
    cutOffDetail,
    cutOffProblems,
    scrollProblems,
    inFlow,
    spillWidth,
    spillProblems,
    overlap,
    topmostAt,
    samplePoints,
    uncovered,
    overlapProblems,
    lineCount,
    wrapProblems,
    widthOf,
    hasContent,
    isLayoutBox,
    collapseProblems,
    imageProblems,
    textSpacing,
    spacingProblems,
    measureAll,
  ];
  return `${functions.map(String).join("\n")}\nwindow.upLayoutMeasure = measureAll;`;
}
