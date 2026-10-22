/* 从当前源码生成含视频的单文件版本；CSP 仅允许实际内联脚本哈希。 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const dest=path.resolve(process.argv[2]||path.join(root,'notice-to-action-offline.html'));
const mime={'.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.webm':'video/webm'};
const uri=name=>`data:${mime[path.extname(name)]};base64,${fs.readFileSync(path.join(root,name)).toString('base64')}`;
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const icons={};for(const file of fs.readdirSync(path.join(root,'assets/icons'))){if(file.endsWith('.svg'))icons[file.slice(0,-4)]=uri('assets/icons/'+file);}
const css=fs.readFileSync(path.join(root,'assets/styles.css'),'utf8').replace('url("campus-background.webp")',`url("${uri('assets/campus-background.webp')}")`);
html=html.replace(/<link rel="stylesheet" href="assets\/styles\.css(?:\?[^\"]*)?">/,()=>`<style>${css}</style>`);
const hashes=[],inlineScripts=[];
html=html.replace(/<script src="(assets\/[^\"]+\.js)(?:\?[^\"]*)?" defer>\s*<\/script>/g,(_,name)=>{
  let code=fs.readFileSync(path.join(root,name),'utf8').replace(/\r\n/g,'\n');
  if(name==='assets/app.js')code='const NOTICE_ICON_DATA='+JSON.stringify(icons)+';\n'+code.replace('assets/icons/${name}.svg','${NOTICE_ICON_DATA[name]}').replaceAll('assets/tutorial-poster.jpg',uri('assets/tutorial-poster.jpg'));
  hashes.push("'sha256-"+crypto.createHash('sha256').update(code).digest('base64')+"'");
  inlineScripts.push(`<script>${code}</script>`);
  return '';
});
if(hashes.length!==3)throw Error('离线构建失败：应完整内嵌三个脚本');
// 内联脚本的 defer 不生效，放到正文后执行，保持原版依赖次序。
html=html.replace('</body>',()=>inlineScripts.join('\n')+'\n</body>');
html=html.replaceAll("script-src 'self'",'script-src '+hashes.join(' '));
html=html.replace(/assets\/icons\/([a-z0-9-]+)\.svg/g,(_,name)=>icons[name]);
html=html.replaceAll('assets/tutorial.webm',uri('assets/tutorial.webm'));
fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,html);
console.log(JSON.stringify({path:dest,bytes:fs.statSync(dest).size,scriptHashes:hashes.length}));
