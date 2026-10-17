using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Web.Script.Serialization;
using System.Threading;

namespace DBArkWindowsFiles {
  // 固定Windows x64/NTFS helper。请求只能引用本次登记的三个槽位，秘密仅以二进制payload进入。
  public static class Program {
    const uint READ_CONTROL=0x20000, WRITE_DAC=0x40000, WRITE_OWNER=0x80000, DELETE=0x10000, SYNC=0x100000, ATTR=0x80;
    const uint BACKUP=0x02000000, REPARSE=0x00200000, SHARE_RW=3, SHARE_ALL=7;
    const uint FILE_GENERIC_WRITE=0x00120116;
    static readonly IntPtr INVALID=new IntPtr(-1);
    [StructLayout(LayoutKind.Sequential)] struct UnicodeString { public ushort Length, MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct ObjectAttributes { public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService; }
    [StructLayout(LayoutKind.Sequential)] struct IoStatus { public IntPtr Status, Information; }
    [StructLayout(LayoutKind.Sequential)] struct BasicInfo { public uint Attributes; public uint CreationLow,CreationHigh,AccessLow,AccessHigh,WriteLow,WriteHigh,Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("ntdll.dll")] static extern int NtCreateFile(out IntPtr handle,uint access,ref ObjectAttributes attributes,out IoStatus status,IntPtr allocation,uint fileAttributes,uint share,uint disposition,uint options,IntPtr ea,uint eaLength);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr process,IntPtr source,IntPtr target,out IntPtr result,uint access,bool inherit,uint options);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr handle,out BasicInfo info);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(IntPtr handle,int infoClass,[Out] byte[] info,uint bytes);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(IntPtr handle,StringBuilder path,uint length,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationByHandleW(IntPtr handle,StringBuilder volume,uint volumeLength,out uint serial,out uint maxComponent,out uint flags,StringBuilder fs,uint fsLength);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr ReOpenFile(IntPtr original,uint access,uint share,uint flags);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(IntPtr handle,int infoClass,byte[] info,uint bytes);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFilePointerEx(IntPtr handle,long distance,out long actual,uint method);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool WriteFile(IntPtr handle,IntPtr bytes,uint count,out uint written,IntPtr overlapped);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool FlushFileBuffers(IntPtr handle);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFileAttributesW(string path);
    [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(IntPtr handle,int type,uint info,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
    [DllImport("advapi32.dll",SetLastError=true)] static extern uint SetSecurityInfo(IntPtr handle,int type,uint info,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint revision,out IntPtr descriptor,out uint bytes);
    [DllImport("advapi32.dll")] static extern bool GetSecurityDescriptorOwner(IntPtr descriptor,out IntPtr owner,out bool defaulted);
    [DllImport("advapi32.dll")] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor,out bool present,out IntPtr dacl,out bool defaulted);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);

    sealed class Slot { public int Id; public string Path,Identity; public bool Directory,Created,CloseAttempted,WorkClosed,Removed,RemovalAttempted; public IntPtr Guard,Work,DeleteHandle; }
    sealed class Extra { public IntPtr Handle; public bool CloseAttempted; }
    static readonly Slot[] slots=new Slot[4];
    static readonly List<Extra> ancestors=new List<Extra>(), probes=new List<Extra>();
    static readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=16384, RecursionLimit=12 };
    static readonly UTF8Encoding utf8=new UTF8Encoding(false,true);
    static string nonce, root, leaf, sid; static bool initialized,failed,cleanupGranted; static uint sequence; static int writtenTotal;
    static Exception Block() { return new InvalidOperationException("受控Windows文件操作未确认"); }
    static void Need(bool condition) { if(!condition) throw Block(); }
    static Dictionary<string,object> D(params object[] fields) { var value=new Dictionary<string,object>(); for(int i=0;i<fields.Length;i+=2)value.Add((string)fields[i],fields[i+1]); return value; }
    static string Text(Dictionary<string,object> meta,string key,int max) { object value; Need(meta.TryGetValue(key,out value)&&value is string); var text=(string)value; Need(text.Length>0&&text.Length<=max&&text.IndexOf('\0')<0); return text; }
    static int Number(Dictionary<string,object> meta,string key) { object value; Need(meta.TryGetValue(key,out value)&&value is int); return (int)value; }
    static void Keys(Dictionary<string,object> meta,params string[] keys) { Need(meta.Count==keys.Length); foreach(string key in keys)Need(meta.ContainsKey(key)); }
    static void ValidHandle(IntPtr value) { Need(value!=IntPtr.Zero&&value!=INVALID); }
    // 先登记原句柄，再进行任何检查。CloseHandle失败不丢弃指针，不重试。
    static Extra Reserve(List<Extra> list) { foreach(var previous in list)if(previous.Handle==IntPtr.Zero) { previous.CloseAttempted=false; return previous; } Need(list.Count<40); var item=new Extra(); list.Add(item); return item; }
    static void CloseExtra(Extra item) { Need(!item.CloseAttempted); item.CloseAttempted=true; Need(CloseHandle(item.Handle)); item.Handle=IntPtr.Zero; }
    static void Close(ref IntPtr handle) { ValidHandle(handle); Need(CloseHandle(handle)); handle=IntPtr.Zero; }
    static string Identity(IntPtr handle,bool directory) {
      BasicInfo basic; Need(GetFileInformationByHandle(handle,out basic)); Need((basic.Attributes&0x400)==0&&((basic.Attributes&0x10)!=0)==directory); if(!directory)Need(basic.Links==1);
      byte[] id=new byte[24]; Need(GetFileInformationByHandleEx(handle,18,id,24)); return BitConverter.ToString(id).Replace("-","").ToLowerInvariant();
    }
    static void CheckFinal(IntPtr handle,string expected) { var path=new StringBuilder(512); uint length=GetFinalPathNameByHandleW(handle,path,512,0); Need(length>0&&length<512); Need(String.Equals(path.ToString(),"\\\\?\\"+expected,StringComparison.OrdinalIgnoreCase)); }
    static IntPtr Probe(Slot slot) {
      var probe=Reserve(probes); var handle=CreateFileW(slot.Path,READ_CONTROL|ATTR,SHARE_ALL,IntPtr.Zero,3,BACKUP|REPARSE,IntPtr.Zero); if(handle!=INVALID)probe.Handle=handle; ValidHandle(handle);
      Need(Identity(handle,slot.Directory)==slot.Identity); CheckFinal(handle,slot.Path); CloseExtra(probe); return slot.Guard;
    }
    static object Stamp(Slot slot) { ValidHandle(slot.Guard); Need(Identity(slot.Guard,slot.Directory)==slot.Identity); Probe(slot); return D("identity",slot.Identity,"entryIdentity",slot.Identity,"kind",slot.Directory?"directory":"file","unsafeLink",false); }
    static string Sddl(bool directory) { string inherit=directory?"OICI":""; return "O:"+sid+"D:P(A;"+inherit+";FA;;;"+sid+")(A;"+inherit+";FA;;;SY)"; }
    // 从原句柄读取完整安全描述符，所有ACE参与核验，不筛掉多余或deny条目。
    static Dictionary<string,object> Acl(Slot slot) {
      ValidHandle(slot.Guard); IntPtr owner,group,dacl,sacl,descriptor;
      Need(GetSecurityInfo(slot.Guard,1,5,out owner,out group,out dacl,out sacl,out descriptor)==0);
      try {
        uint size=GetSecurityDescriptorLength(descriptor); Need(size>0&&size<=16384); byte[] data=new byte[size]; Marshal.Copy(descriptor,data,0,(int)size);
        var raw=new RawSecurityDescriptor(data,0); var aces=new List<object>(); Need(raw.DiscretionaryAcl!=null&&raw.DiscretionaryAcl.Count<=8);
        foreach(GenericAce item in raw.DiscretionaryAcl) { var ace=item as CommonAce; Need(ace!=null&&!ace.IsCallback&&ace.AceFlags==(slot.Directory?AceFlags.ContainerInherit|AceFlags.ObjectInherit:AceFlags.None)); aces.Add(D("sid",ace.SecurityIdentifier.Value,"allow",ace.AceQualifier==AceQualifier.AccessAllowed,"inherited",(ace.AceFlags&AceFlags.Inherited)!=0,"fullControl",ace.AccessMask==0x1f01ff,"containerInherit",(ace.AceFlags&AceFlags.ContainerInherit)!=0,"objectInherit",(ace.AceFlags&AceFlags.ObjectInherit)!=0)); }
        return D("identity",slot.Identity,"ownerSid",raw.Owner.Value,"inheritanceDisabled",(raw.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0,"aces",aces);
      } finally { LocalFree(descriptor); }
    }
    static void RequireAcl(Slot slot) {
      var proof=Acl(slot); Need((string)proof["ownerSid"]==sid&&(bool)proof["inheritanceDisabled"]); var aces=(List<object>)proof["aces"]; Need(aces.Count==2); var allowed=new HashSet<string> { sid,"S-1-5-18" };
      foreach(object value in aces) { var ace=(Dictionary<string,object>)value; Need(allowed.Remove((string)ace["sid"])&&(bool)ace["allow"]&&!(bool)ace["inherited"]&&(bool)ace["fullControl"]&&(bool)ace["containerInherit"]==slot.Directory&&(bool)ace["objectInherit"]==slot.Directory); } Need(allowed.Count==0);
    }
    static void Protect(Slot slot) {
      Need(slot.Id!=1&&slot.Created&&!slot.WorkClosed); IntPtr descriptor; uint bytes; Need(ConvertStringSecurityDescriptorToSecurityDescriptorW(Sddl(slot.Directory),1,out descriptor,out bytes));
      try { IntPtr owner,dacl; bool present,defaulted; Need(GetSecurityDescriptorOwner(descriptor,out owner,out defaulted)&&GetSecurityDescriptorDacl(descriptor,out present,out dacl,out defaulted)&&present); Need(SetSecurityInfo(slot.Work,1,0x80000005,owner,IntPtr.Zero,dacl,IntPtr.Zero)==0); }
      finally { LocalFree(descriptor); }
      RequireAcl(slot);
    }
    static void DuplicateWork(Slot slot) { Need(DuplicateHandle(GetCurrentProcess(),slot.Guard,GetCurrentProcess(),out slot.Work,0,false,2)); }
    // 根的每个祖先都以deny-share-delete固定，拒绝UNC、设备路径和所有重解析点。
    static object Init(Dictionary<string,object> meta) {
      Keys(meta,"owner","root","leaf","sid"); Need(!initialized&&sequence==1&&Environment.Is64BitProcess&&Environment.OSVersion.Platform==PlatformID.Win32NT&&Environment.OSVersion.Version.Major>=10);
      nonce=Text(meta,"owner",64); Need(System.Text.RegularExpressions.Regex.IsMatch(nonce,"^[a-f0-9]{32}$"));
      root=Text(meta,"root",180); leaf=Text(meta,"leaf",100); sid=Text(meta,"sid",200); Need(sid==WindowsIdentity.GetCurrent().User.Value&&sid!="S-1-5-18");
      Need(System.Text.RegularExpressions.Regex.IsMatch(root,@"^[A-Za-z]:\\[ -~]+$")&&Path.GetFullPath(root)==root&&!root.EndsWith("\\")&&System.Text.RegularExpressions.Regex.IsMatch(leaf,"^[A-Za-z0-9_-]{1,100}$")); Need(Path.Combine(root,leaf,"client.cnf").Length<=240);
      var parts=root.Substring(3).Split('\\'); string current=root.Substring(0,3); var paths=new List<string> { current };
      foreach(string part in parts) { Need(part.Length>0&&part!="."&&part!=".."&&!part.EndsWith(" ")&&!part.EndsWith(".")&&part.IndexOfAny(new char[]{':','/','*','?','"','<','>','|'})<0); current=Path.Combine(current,part); paths.Add(current); }
      foreach(string path in paths) { var record=Reserve(ancestors); uint access=READ_CONTROL|ATTR|SYNC|0x20u|(path==root?4u:0u); var handle=CreateFileW(path,access,SHARE_RW,IntPtr.Zero,3,BACKUP|REPARSE,IntPtr.Zero); if(handle!=INVALID)record.Handle=handle; ValidHandle(handle); Identity(handle,true); CheckFinal(handle,path); }
      var parent=new Slot { Id=1,Path=root,Directory=true,Guard=ancestors[ancestors.Count-1].Handle }; slots[1]=parent; parent.Identity=Identity(parent.Guard,true); DuplicateWork(parent);
      var fs=new StringBuilder(32); uint serial,max,flags; Need(GetVolumeInformationByHandleW(parent.Guard,null,0,out serial,out max,out flags,fs,32)&&fs.ToString()=="NTFS"); initialized=true; return D("id",1,"stamp",Stamp(parent));
    }
    // NtCreateFile FILE_CREATE从已固定的父句柄相对创建；不能mkdir后再追随一个被换绑的入口。
    static object Create(bool directory) {
      int id=directory?2:3; Need(slots[id]==null); Slot parent=slots[directory?1:2]; Need(parent!=null&&!parent.WorkClosed); RequireAcl(parent); Probe(parent);
      var slot=new Slot { Id=id,Directory=directory,Path=Path.Combine(parent.Path,directory?leaf:"client.cnf") }; slots[id]=slot;
      IntPtr text=IntPtr.Zero,unicodePtr=IntPtr.Zero,descriptor=IntPtr.Zero; uint descriptorBytes;
      try {
        string name=directory?leaf:"client.cnf"; text=Marshal.StringToHGlobalUni(name); var unicode=new UnicodeString { Length=(ushort)(name.Length*2), MaximumLength=(ushort)((name.Length+1)*2), Buffer=text }; unicodePtr=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeString))); Marshal.StructureToPtr(unicode,unicodePtr,false);
        Need(ConvertStringSecurityDescriptorToSecurityDescriptorW(Sddl(directory),1,out descriptor,out descriptorBytes));
        var attributes=new ObjectAttributes { Length=Marshal.SizeOf(typeof(ObjectAttributes)),RootDirectory=parent.Guard,ObjectName=unicodePtr,Attributes=0x1040,SecurityDescriptor=descriptor };
        IoStatus status; uint access=READ_CONTROL|WRITE_DAC|WRITE_OWNER|ATTR|SYNC|(directory?DELETE|0x20u|2u:FILE_GENERIC_WRITE);
        IntPtr created; int result=NtCreateFile(out created,access,ref attributes,out status,IntPtr.Zero,directory?0x10u:0x80u,directory?SHARE_RW:5u,2,0x200020u|(directory?1u:0x40u),IntPtr.Zero,0);
        if(created!=IntPtr.Zero&&created!=INVALID) { if(directory)slot.Guard=created; else slot.Work=created; }
        Need(result>=0&&status.Information.ToInt64()==2); slot.Created=true;
        if(directory)DuplicateWork(slot); else Need(DuplicateHandle(GetCurrentProcess(),slot.Work,GetCurrentProcess(),out slot.Guard,READ_CONTROL|ATTR|SYNC,false,0));
        slot.Identity=Identity(slot.Guard,directory); CheckFinal(slot.Guard,slot.Path); RequireAcl(slot); return D("id",id,"stamp",Stamp(slot));
      } finally { if(text!=IntPtr.Zero)Marshal.FreeHGlobal(text); if(unicodePtr!=IntPtr.Zero)Marshal.FreeHGlobal(unicodePtr); if(descriptor!=IntPtr.Zero)LocalFree(descriptor); }
    }
    static void CloseWork(Slot slot) {
      Need(!slot.CloseAttempted); if(slot.Id==1)Need((slots[2]==null||slots[2].Removed)&&(slots[3]==null||slots[3].Removed)); slot.CloseAttempted=true; Close(ref slot.Work); slot.WorkClosed=true;
      if(slot.Id==1) { for(int i=ancestors.Count-1;i>=0;i--)CloseExtra(ancestors[i]); slot.Guard=IntPtr.Zero; }
    }
    static void Remove(Slot slot,string expected) {
      Need(cleanupGranted&&slot.Id!=1&&slot.Created&&slot.WorkClosed&&!slot.RemovalAttempted&&slot.Identity==expected); if(slot.Directory)Need(slots[3]==null||slots[3].Removed);
      slot.RemovalAttempted=true; Probe(slot); RequireAcl(slot); Need(Identity(slot.Guard,slot.Directory)==expected);
      if(!slot.Directory) { slot.DeleteHandle=ReOpenFile(slot.Guard,DELETE|READ_CONTROL|ATTR|SYNC,SHARE_ALL,0); ValidHandle(slot.DeleteHandle); Need(Identity(slot.DeleteHandle,false)==expected); }
      IntPtr deletion=slot.Directory?slot.Guard:slot.DeleteHandle; Need(SetFileInformationByHandle(deletion,4,new byte[]{1},1));
      Close(ref slot.Guard); if(!slot.Directory)Close(ref slot.DeleteHandle);
      uint attrs=GetFileAttributesW(slot.Path); Need(attrs==0xffffffff&&Marshal.GetLastWin32Error()==2); slot.Removed=true;
    }
    static object Counts() {
      int guards=0,writers=0; foreach(var item in ancestors)if(item.Handle!=IntPtr.Zero)guards++; foreach(var item in probes)if(item.Handle!=IntPtr.Zero)guards++;
      for(int i=1;i<4;i++) { Slot slot=slots[i]; if(slot==null)continue; if(i!=1&&slot.Guard!=IntPtr.Zero)guards++; if(slot.Work!=IntPtr.Zero)writers++; if(slot.DeleteHandle!=IntPtr.Zero)guards++; }
      return D("guards",guards,"writers",writers,"failed",failed);
    }
    static object Dispatch(byte op,Dictionary<string,object> meta,byte[] body,int payloadAt,int payloadLength) {
      if(op==1)return Init(meta); Need(initialized&&Text(meta,"owner",64)==nonce);
      if(op==13) { Keys(meta,"owner"); return Counts(); }
      if(op==14) { Keys(meta,"owner"); var counts=(Dictionary<string,object>)Counts(); Need((int)counts["guards"]==0&&(int)counts["writers"]==0); return D("shutdown",true); }
      if(op==10) { Keys(meta,"owner","originalOperationLeft","nativeClosed","streamsClosed"); Need(meta["originalOperationLeft"] is bool&&(bool)meta["originalOperationLeft"]&&meta["nativeClosed"] is bool&&(bool)meta["nativeClosed"]&&meta["streamsClosed"] is bool&&(bool)meta["streamsClosed"]); cleanupGranted=true; foreach(var item in probes)if(item.Handle!=IntPtr.Zero&&!item.CloseAttempted)CloseExtra(item); return D("granted",cleanupGranted); }
      if(op==3||op==4) { Keys(meta,"owner"); Need(!failed&&!cleanupGranted); return Create(op==3); }
      int id=Number(meta,"id"); Need(id>=1&&id<=3&&slots[id]!=null); Slot slot=slots[id];
      if(op==2||op==5||op==6||op==8||op==9)Keys(meta,"owner","id");
      if(op==2)return Stamp(slot); if(op==5)return Acl(slot); if(op==6) { Need(!failed&&!cleanupGranted); Protect(slot); return Acl(slot); }
      if(op==7) {
        Keys(meta,"owner","id","position"); Need(!failed&&!cleanupGranted&&id==3&&!slot.WorkClosed&&payloadLength>0&&payloadLength<=65536&&Number(meta,"position")==writtenTotal&&writtenTotal+payloadLength<=65536);
        RequireAcl(slots[1]); RequireAcl(slots[2]); RequireAcl(slot); Probe(slot); long actual; Need(SetFilePointerEx(slot.Work,writtenTotal,out actual,0)&&actual==writtenTotal);
        var pinned=GCHandle.Alloc(body,GCHandleType.Pinned); try { uint count; Need(WriteFile(slot.Work,IntPtr.Add(pinned.AddrOfPinnedObject(),payloadAt),(uint)payloadLength,out count,IntPtr.Zero)&&count>0&&count<=payloadLength); writtenTotal+=(int)count; return D("written",count); } finally { pinned.Free(); }
      }
      Need(payloadLength==0);
      if(op==8) { Need(!failed&&id==3&&!slot.WorkClosed); Need(FlushFileBuffers(slot.Work)); return D("synced",true); }
      if(op==9) { if(failed)Need(cleanupGranted); CloseWork(slot); return D("workClosed",slot.WorkClosed,"guardHeld",slot.Guard!=IntPtr.Zero); }
      if(op==11||op==12) { Keys(meta,"owner","id","identity"); Need(id==(op==11?3:2)); Remove(slot,Text(meta,"identity",64)); return D("identity",slot.Identity,"removed",slot.Removed); }
      throw Block();
    }
    static bool ReadFully(Stream input,byte[] bytes) { int at=0; while(at<bytes.Length) { int count=input.Read(bytes,at,bytes.Length-at); if(count==0) { Need(at==0); return false; } at+=count; } return true; }
    static void Reply(Stream output,uint seq,bool ok,object result) { byte[] bytes=utf8.GetBytes(json.Serialize(D("seq",seq,"owner",nonce??"","ok",ok,"result",result,"counts",Counts()))); Need(bytes.Length<=16384); byte[] length=BitConverter.GetBytes(bytes.Length); output.Write(length,0,4); output.Write(bytes,0,bytes.Length); output.Flush(); Array.Clear(bytes,0,bytes.Length); }
    // EOF/协议损坏且仍有原句柄时不finally清理、不自动退出；Root保留原helper作明确未知恢复。
    public static int Run() {
      Stream input=Console.OpenStandardInput(),output=Console.OpenStandardOutput();
      try { while(true) {
        byte[] header=new byte[4]; if(!ReadFully(input,header))break; int length=BitConverter.ToInt32(header,0); Need(length>=9&&length<=70000); byte[] body=new byte[length]; uint seq=0;
        try {
          Need(ReadFully(input,body)); seq=BitConverter.ToUInt32(body,0); Need(seq==sequence+1&&seq<=Int32.MaxValue); sequence=seq; byte op=body[4]; int metaLength=BitConverter.ToInt32(body,5); Need(metaLength>0&&metaLength<=4096&&9+metaLength<=body.Length);
          var meta=json.Deserialize<Dictionary<string,object>>(utf8.GetString(body,9,metaLength)); int payloadAt=9+metaLength,payloadLength=body.Length-payloadAt; Need(op==7||payloadLength==0);
          object result=Dispatch(op,meta,body,payloadAt,payloadLength); Reply(output,seq,true,result); if(op==14)return 0;
        } catch { failed=true; if(seq>0)Reply(output,seq,false,D("code",1)); else throw; }
        finally { Array.Clear(body,0,body.Length); }
      } } catch { failed=true; }
      var remaining=(Dictionary<string,object>)Counts(); if((int)remaining["guards"]>0||(int)remaining["writers"]>0)new ManualResetEvent(false).WaitOne();
      return 71;
    }
  }
}
