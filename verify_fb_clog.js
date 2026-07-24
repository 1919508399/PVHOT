/* 验证 feedback + changelog 视图（v3.1） */
const { JSDOM } = require("jsdom");

const html = require("fs").readFileSync("C:/Users/HUASUN/Desktop/新闻/index.html", "utf8");

const dom = new JSDOM(html, {
  url: "http://127.0.0.1:8099/index.html",
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  beforeParse(win) {
    win.fetch = () => Promise.reject(new Error("no fetch in jsdom"));
    win.localStorage = {
      _: {},
      getItem(k) { return this._[k] ?? null; },
      setItem(k, v) { this._[k] = String(v); },
      removeItem(k) { delete this._[k]; },
      clear() { this._ = {}; },
    };
  },
});

const w = dom.window;
setTimeout(() => {
  const D = w.document;
  let pass = 0, fail = 0;
  const eq = (actual, expected, name) => {
    const ok = actual === expected;
    console.log((ok ? "  ✓ " : "  ✗ ") + name + " — " + (ok ? expected : "expected " + expected + ", got " + actual));
    if (ok) pass++; else fail++;
  };
  const truthy = (val, name) => {
    const ok = !!val;
    console.log((ok ? "  ✓ " : "  ✗ ") + name);
    if (ok) pass++; else fail++;
  };
  const regex = (s, r, name) => {
    const ok = r.test(s || "");
    console.log((ok ? "  ✓ " : "  ✗ ") + name);
    if (ok) pass++; else fail++;
  };

  // === 1. feedback 视图 ===
  console.log("\n[反馈页]");
  D.querySelector('.sb-item[data-view="feedback"]').click();
  truthy(D.querySelector(".fb-page"), "fb.page");
  truthy(D.querySelector(".abt-eyebrow"), "fb.eyebrow");
  eq(D.querySelector(".abt-eyebrow").textContent.trim(), "反 馈", "fb.eyebrowText");
  truthy(D.querySelector(".fb-form"), "fb.form");
  truthy(D.querySelector("#fbMsg"), "fb.textarea");
  eq(D.querySelector("#fbMsg").getAttribute("maxlength"), "2000", "fb.maxlength");
  eq(D.querySelector("#fbMsg").getAttribute("placeholder"), "比如", "fb.placeholder");
  truthy(D.querySelector("#fbEmail"), "fb.email");
  truthy(D.querySelector("#fbSubmit"), "fb.submit");
  eq(D.querySelector("#fbSubmit").textContent.trim(), "发送反馈", "fb.submitText");
  truthy(D.querySelector("#fbCount"), "fb.count");
  eq(D.querySelector("#fbCount").textContent, "0", "fb.count0");
  truthy(D.querySelector(".fb-hint"), "fb.hint");
  truthy(D.querySelector("#fbSent[hidden]"), "fb.sentHiddenByDefault");

  // === 2. 字数计数 ===
  console.log("\n[字数计数]");
  const ta = D.querySelector("#fbMsg");
  const ct = D.querySelector("#fbCount");
  ta.value = "光伏产业一周动态";
  ta.dispatchEvent(new w.Event("input"));
  eq(ct.textContent, "8", "fb.countAfter8");
  ta.value = "a".repeat(1500);
  ta.dispatchEvent(new w.Event("input"));
  eq(ct.textContent, "1500", "fb.countAfter1500");

  // === 3. 草稿保存 ===
  console.log("\n[草稿保存]");
  setTimeout(() => {
    const draft = w.localStorage.getItem("pvhot-feedback-draft");
    truthy(draft, "fb.draftSaved");
    regex(draft, /光伏产业一周动态|aaaa/, "fb.draftContent");

    // === 4. 提交反馈 ===
    console.log("\n[提交反馈]");
    ta.value = "建议增加钙钛矿专题";
    ta.dispatchEvent(new w.Event("input"));
    D.querySelector("#fbForm").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));

    // 提交后 UI 状态
    eq(!!D.querySelector("#fbSent:not([hidden])"), true, "fb.sentShown");
    eq(D.querySelector("#fbCount").textContent, "0", "fb.countAfterSubmit");
    eq(D.querySelector("#fbMsg").value, "", "fb.textareaCleared");
    const list = JSON.parse(w.localStorage.getItem("pvhot-feedback-list") || "[]");
    truthy(list.length === 1, "fb.listLen1");
    truthy(list[0].msg === "建议增加钙钛矿专题", "fb.listMsg");
    truthy(list[0].id && list[0].id.startsWith("fb_"), "fb.listId");

    // 草稿清除
    eq(w.localStorage.getItem("pvhot-feedback-draft"), null, "fb.draftCleared");

    // === 5. changelog 视图（去掉 1:1 复刻 aihot）===
    console.log("\n[更新日志]");
    D.querySelector('.sb-item[data-view="changelog"]').click();
    const card = D.querySelector(".info-card");
    const text = card.textContent;
    regex(text, /v3\.1/, "clog.v31");
    regex(text, /v3\.0/, "clog.v30");
    regex(text, /v2\.0/, "clog.v20");
    regex(text, /v1\.0/, "clog.v10");
    truthy(!/1[\s:：]*1[\s]*复刻/.test(text), "clog.no11Copy");
    truthy(!/aihot\.virxact\.com/.test(text), "clog.noAihotUrl");
    truthy(!/参考\s*aihot/i.test(text), "clog.noRefAihot");
    regex(text, /光伏/, "clog.mentionsPV");

    // === 6. 切换不坏 ===
    console.log("\n[切回不坏]");
    D.querySelector('.sb-item[data-view="featured"]').click();
    truthy(D.querySelectorAll(".tl-card").length > 0, "featured.timeline");
    D.querySelector('.sb-item[data-view="about"]').click();
    truthy(D.querySelector(".abt-page"), "about.stillWorks");
    D.querySelector('.sb-item[data-view="feedback"]').click();
    truthy(D.querySelector(".fb-page"), "feedback.stillWorks");

    console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
  }, 300);
}, 800);
