const title = 'A Silicon Valley company with Eric Trump as an advisor is making robot soldiers';
const summary = 'A Silicon Valley company with Eric Trump as an advisor is making robot soldiers';
const tNorm = title.toLowerCase().replace(/[^\w一-鿿]+/g, ' ').trim();
const sNorm = summary.toLowerCase().replace(/[^\w一-鿿]+/g, ' ').trim();
console.log('tNorm:', JSON.stringify(tNorm));
console.log('sNorm:', JSON.stringify(sNorm));
console.log('tNorm.slice(0,30):', JSON.stringify(tNorm.slice(0,30)));
console.log('sNorm.startsWith(tNorm.slice(0,30)):', sNorm.startsWith(tNorm.slice(0,30)));
console.log('tNorm.startsWith(sNorm.slice(0,30)):', tNorm.startsWith(sNorm.slice(0,30)));
console.log('tNorm === sNorm:', tNorm === sNorm);

// 再测中文
const t2 = '晶澳科技发布全新N型组件';
const s2 = '晶澳科技发布全新N型组件';
const tn2 = t2.toLowerCase().replace(/[^\w一-鿿]+/g, ' ').trim();
const sn2 = s2.toLowerCase().replace(/[^\w一-鿿]+/g, ' ').trim();
console.log('---');
console.log('tn2:', JSON.stringify(tn2));
console.log('sn2:', JSON.stringify(sn2));
console.log('tn2===sn2:', tn2===sn2);
console.log('sn2.startsWith(tn2.slice(0,5)):', sn2.startsWith(tn2.slice(0,5)));
