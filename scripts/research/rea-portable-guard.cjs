// 只用于本项目便携REA样例。限制Node侧网络/私料访问及子进程；不宣称是JVM或原生插件的安全沙箱。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),url=require('node:url');
const cache=process.env.DBARK_REA_CACHE,mode=process.env.DBARK_REA_MODE,record=process.env.DBARK_REA_RECORD??mode;
if(!cache||!['help','doctor','sample'].includes(mode))throw Error('缺少便携REA受控模式');
if(!/^[a-z0-9-]+$/u.test(record))throw Error('运行记录名称无效');
const manifest=JSON.parse(fs.readFileSync(path.join(cache,'toolchain.json'),'utf8')),save=fs.writeFileSync.bind(fs),audit={externalNetwork:0,loopback:0,privateRead:0,blockedProcess:0,javaProbes:0};
const reject=key=>()=>{audit[key]++;throw Error('便携REA限制：'+key);};
const net=require('node:net'),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let first=args[0];if(Array.isArray(first))first=first[0];const host=typeof first==='object'?first.host:typeof args[1]==='string'?args[1]:undefined;if(!['127.0.0.1','::1'].includes(host))return reject('externalNetwork')();audit.loopback++;return connect.apply(this,args);};
globalThis.fetch=reject('externalNetwork');
const filename=file=>file instanceof URL?url.fileURLToPath(file):Buffer.isBuffer(file)?file.toString():file;
for(const owner of [fs,fs.promises])for(const name of ['readFile','readFileSync','open','openSync'])if(typeof owner[name]==='function'){const original=owner[name];owner[name]=function(file,...args){const value=filename(file);if(typeof value==='string'&&/(?:\.env(?:\.[^\\/]*)?$|runtime\.json$|\.(?:pem|pfx|key|p12)$|[\\/]\.ssh[\\/]|PremiumSoft[\\/]Navicat)/iu.test(value))return reject('privateRead')();return original.call(this,file,...args);};}
// 版本/属性探针在REA外层追加64MiB限制；真正分析由REA的GHIDRA_HEADLESS_MAXMEM再限制为256MiB。
for(const name of ['spawn','spawnSync','execFile','execFileSync']){const original=cp[name];cp[name]=function(program,args,...rest){if(mode==='help')return reject('blockedProcess')();const actual=path.resolve(String(program));if(actual.toLowerCase()===path.join(manifest.javaHome,'bin/java.exe').toLowerCase()){if(!Array.isArray(args))return reject('blockedProcess')();const probe=args.some(value=>value==='-version'||value==='--version'||value==='-XshowSettings:properties');audit.javaProbes++;args=['-Xms16m',probe?'-Xmx64m':'-Xmx256m','-XX:ActiveProcessorCount=1',...args];return original.call(this,program,args,...rest);}if(actual.toLowerCase()===manifest.node.toLowerCase())return original.call(this,program,args,...rest);return reject('blockedProcess')();};}
for(const name of ['exec','execSync'])cp[name]=reject('blockedProcess');
if(mode==='help')cp.fork=reject('blockedProcess');
// Node给dlopen传入扩展路径；使用Windows原生realpath处理，仍比较同一绝对路径和发布包摘要。
const load=process.dlopen;process.dlopen=function(module,file,...args){if(mode==='help')return reject('blockedProcess')();const actual=fs.realpathSync.native(file);if(actual!==manifest.native.path||crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex')!==manifest.native.sha256)throw Error('拒绝未绑定的原生模块');return load.call(this,module,file,...args);};
process.on('exit',()=>save(path.join(cache,record+'-guard-audit.json'),JSON.stringify(audit,null,2)+'\n'));
require('node:module').syncBuiltinESMExports();
