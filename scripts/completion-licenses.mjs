import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFile,readdir,mkdir,copyFile,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
/** 从实际解析入口向上寻找包根，兼容pnpm隔离链接及各包exports限制。 */
async function packageRoot(entry,name){let directory=dirname(entry);for(let level=0;level<8;level++){try{const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(manifest.name===name)return{directory,manifest};}catch(error){if(error.code!=='ENOENT')throw error;}const parent=dirname(directory);if(parent===directory)break;directory=parent;}throw Error('无法确认补全解析依赖来源：'+name);}
/** Worker已内含解析代码，仍须随真实安装产物带上每个实际依赖的原始版权和许可全文。 */
export async function copyCompletionLicenses(){
  const parser=await packageRoot(require.resolve('dt-sql-parser'),'dt-sql-parser'),parserRequire=createRequire(join(parser.directory,'package.json')),output='dist/renderer/third-party';await mkdir(output,{recursive:true});
  const expected=[['dt-sql-parser','4.5.1','MIT'],['antlr4-c3','3.3.7','MIT'],['antlr4ng','2.0.11','BSD-3-Clause']],records=[];
  for(const[name,version,license]of expected){const{directory,manifest}=name==='dt-sql-parser'?parser:await packageRoot(parserRequire.resolve(name),name);if(manifest.version!==version||manifest.license!==license)throw Error('补全依赖或许可已变化，请重新核对：'+name);const file=(await readdir(directory)).find(value=>/^LICENSE(?:\.txt|\.md)?$/i.test(value));if(!file)throw Error('补全依赖缺少许可原件：'+name);const target=name+'-'+version+'.txt';await copyFile(join(directory,file),join(output,target));records.push({name,version,license,file:target});}
  await writeFile(join(output,'sql-completion.json'),JSON.stringify({说明:'本地SQL补全Worker使用的第三方依赖，许可原文随安装产物提供。',依赖:records},null,2)+'\n');
}
