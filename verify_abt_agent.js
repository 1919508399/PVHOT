// jsdom 验证：about 页 / agent 接入页 / 复制按钮 / goview 链接
const { JSDOM } = require("C:/Users/HUASUN/.workbuddy/binaries/node/workspace/node_modules/jsdom");

const html = require("fs").readFileSync("C:/Users/HUASUN/Desktop/新闻/index.html", "utf8");
const css  = require("fs").readFileSync("C:/Users/HUASUN/Desktop/新闻/styles.css", "utf8");
const fb   = require("fs").readFileSync("C:/Users/HUASUN/Desktop/新闻/data_fallback.js", "utf8");

const dom = new JSDOM(html, {
  url: "http://127.0.0.1:8099/index.html",
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  beforeParse(win) {
    // jsdom 22 默认没有 fetch；让 app.js 走 fallback 路径
    win.fetch = () => Promise.reject(new Error("jsdom: fetch disabled"));
  },
});
const w = dom.window;

// 注入 data_fallback（fetch 失败回退）
w.eval(fb);

// 注入 styles（不参与渲染，仅确认 CSS 解析无误）
const style = w.document.createElement("style");
style.textContent = css;
w.document.head.appendChild(style);

// 等脚本执行完
setTimeout(() => {
  const D = w.document;
  const tests = [];
  const pass = (n, c, info = "") => tests.push({ n, ok: !!c, info });
  const eq = (got, want, label) => {
    if (got === want) pass(label, true, "ok");
    else pass(label, false, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  };

  // —— 关于页 ——
  D.querySelector('.sb-item[data-view="about"]').click();
  eq(D.querySelector("#heroTitle").textContent, "关于", "about.heroTitle");
  eq(D.querySelectorAll(".abt-page").length, 1, "about.abtPage");
  eq(D.querySelectorAll(".abt-eyebrow").length, 1, "about.eyebrow");
  eq(D.querySelectorAll(".abt-h1").length, 1, "about.h1");
  /清洁能源蛋黄派/.test(D.querySelector(".abt-h1").textContent) ?
    pass("about.h1Brand", true, "ok") : pass("about.h1Brand", false, "no brand");
  eq(D.querySelectorAll(".abt-emerald").length >= 1, true, "about.emerald");
  eq(D.querySelectorAll(".abt-popoem p").length, 3, "about.popoem3");
  /光伏圈/.test(D.querySelector(".abt-popoem").textContent) ?
    pass("about.pvCircle", true, "ok") : pass("about.pvCircle", false);
  eq(D.querySelectorAll(".abt-qrcard").length, 1, "about.qrcard.single");
  eq(D.querySelectorAll(".abt-qrframe img").length, 1, "about.qrImg");
  eq(D.querySelector(".abt-qrframe img").getAttribute("src"), "qrcode_wechat.jpg", "about.qrSrc");
  /清洁能源蛋黄派/.test(D.querySelector(".abt-qrfoot").textContent) ?
    pass("about.qrFootBrand", true) : pass("about.qrFootBrand", false);

  // —— Agent 接入页 ——
  D.querySelector('.sb-item[data-view="agent"]').click();
  eq(D.querySelector("#heroTitle").textContent, "Agent 接入", "agent.heroTitle");
  eq(D.querySelectorAll(".agt-page").length, 1, "agent.page");
  /PV HOT/.test(D.querySelector(".abt-h1").textContent) ?
    pass("agent.h1Brand", true) : pass("agent.h1Brand", false);
  eq(D.querySelectorAll(".agt-pill").length, 4, "agent.pills");
  eq(D.querySelectorAll(".agt-card").length, 3, "agent.cards3");
  eq(D.querySelectorAll(".agt-codebox").length >= 5, true, "agent.codeboxes5+");
  eq(D.querySelectorAll(".copy-btn").length >= 5, true, "agent.copyBtns5+");
  eq(D.querySelectorAll(".agt-step").length, 3, "agent.steps3");
  eq(D.querySelectorAll(".agt-platform").length, 6, "agent.platforms6");
  eq(D.querySelectorAll(".agt-callout").length, 4, "agent.callouts4");
  eq(D.querySelectorAll(".agt-linkbtn").length, 3, "agent.linkbtns3");

  // 检查强调色
  const emerald = w.getComputedStyle(D.querySelector(".abt-emerald")).color;
  pass("agent.emeraldStyle", emerald !== "rgb(0, 0, 0)" && emerald !== "", emerald);

  // 检查深色代码块
  const cb = w.getComputedStyle(D.querySelector(".agt-codebox"));
  pass("agent.codeboxBg", cb.backgroundColor && cb.backgroundColor !== "rgba(0, 0, 0, 0)", cb.backgroundColor);

  // —— 复制按钮：模拟点击 ——
  // 拦截 execCommand 模拟复制成功
  w.document.execCommand = () => true;
  D.querySelector('.copy-btn[data-copy="#agtInstall"]').click();
  eq(D.querySelector('.copy-btn[data-copy="#agtInstall"]').textContent, "✓ 已复制", "copy.feedback");

  // —— goview 链接（"反馈页"） ——
  D.querySelector(".abt-page, .agt-page") || D.body;
  // goview 是 info 视图里的，跳到 about 再测
  D.querySelector('.sb-item[data-view="about"]').click();
  const gov = D.querySelector('[data-goview="feedback"]');
  pass("about.goviewExists", !!gov, "");
  if (gov) {
    gov.click();
    eq(D.querySelector("#heroTitle").textContent, "反馈", "goview.jumpToFeedback");
  }

  // —— 切回 featured，确认没坏 ——
  D.querySelector('.sb-item[data-view="featured"]').click();
  eq(D.querySelectorAll(".tl-card").length > 0, true, "featured.timeline");

  // —— 切回 changelog ——
  D.querySelector('.sb-item[data-view="changelog"]').click();
  /v3.0/.test(D.querySelector(".info-card").textContent) ?
    pass("changelog.v3", true) : pass("changelog.v3", false);

  // —— 1.7s 后验证 copy 反馈已恢复（不与其他 DOM 切换冲突） ——
  setTimeout(() => {
    // 先切回 agent 视图
    D.querySelector('.sb-item[data-view="agent"]').click();
    const btn = D.querySelector('.copy-btn[data-copy="#agtInstall"]');
    if (btn) {
      eq(btn.textContent, "复制", "copy.recover");
    } else {
      pass("copy.recover", false, "btn not found");
    }
    runReport();
  }, 1700);

  function runReport() {
    const total = tests.length, ok = tests.filter(t => t.ok).length;
    console.log("========================================");
    tests.forEach(t => console.log(`${t.ok ? "✅" : "❌"} ${t.n}${t.info ? "  | " + t.info : ""}`));
    console.log("========================================");
    console.log(`PASS ${ok}/${total}`);
    process.exit(ok === total ? 0 : 1);
  }
}, 800);
