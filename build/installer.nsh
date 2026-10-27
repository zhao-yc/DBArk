; 仅安装包管理dbark对象链接；应用启动不抢占默认协议，也不执行URI中的命令。
; 模板依据：app-builder-lib 26.15.3 的customInstall/customUnInstall与SHELL_CONTEXT。
; 文档依据：Microsoft aa767914(v=vs.85)、RegOpenKeyExW、RegQueryInfoKeyW；NSIS System插件。
!define DBARK_OBJECT_URI_KEY "Software\Classes\dbark"
!define DBARK_OBJECT_URI_DESCRIPTION "URL:DBArk 对象链接"

; 旧NSIS没有IfShellVarContextAll；沿用同模板设置SHELL_CONTEXT的公开installMode。
!macro DBArkObjectUriContext SUFFIX FAIL
  StrCpy $2 0x80000001
  StrCmpS $installMode "CurrentUser" dbark_uri_context_${SUFFIX}
  StrCmpS $installMode "all" 0 ${FAIL}
  StrCpy $2 0x80000002
  dbark_uri_context_${SUFFIX}:
  StrCpy $4 0x20019
  ; 模板check64BitAndSetRegView已先确认平台；原生读取使用同一64位视图。
  !ifdef APP_64
    IntOp $4 $4 | 0x0100
  !endif
  !ifdef APP_ARM64
    IntOp $4 $4 | 0x0100
  !endif
!macroend

; 只读探测必须区分“不存在”与拒绝访问；空的既有键也不是可抢占的新注册。
!macro DBArkObjectUriOpen KEY
  StrCpy $3 0
  StrCpy $5 -1
  System::Call 'advapi32::RegOpenKeyExW(p r2, w "${KEY}", i 0, i r4, *p .r3) i .r5'
!macroend

; 精确树形计数拒绝后来加入的DelegateExecute/DDE等处理程序，不只比较默认命令。
!macro DBArkObjectUriShape KEY CHILDREN VALUES FAIL
  !insertmacro DBArkObjectUriOpen "${KEY}"
  StrCmpS $5 0 0 ${FAIL}
  System::Call 'advapi32::RegQueryInfoKeyW(p r3, p 0, p 0, p 0, *i .r6, p 0, p 0, *i .r7, p 0, p 0, p 0, p 0) i .r5'
  System::Call 'advapi32::RegCloseKey(p r3) i .r8'
  StrCmpS $8 0 0 ${FAIL}
  StrCmpS $5 0 0 ${FAIL}
  StrCmpS $6 ${CHILDREN} 0 ${FAIL}
  StrCmpS $7 ${VALUES} 0 ${FAIL}
!macroend

; 完整所有权必须同时匹配AppID、版本、实际EXE路径、全部自有值及整棵注册树。
!macro DBArkObjectUriOwned FAIL
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}" 2 5 ${FAIL}
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}\DefaultIcon" 0 1 ${FAIL}
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}\shell" 1 1 ${FAIL}
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}\shell\open" 1 0 ${FAIL}
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}\shell\open\command" 0 1 ${FAIL}
  ClearErrors
  ReadRegStr $9 SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "DBArkOwner"
  IfErrors ${FAIL}
  StrCmpS $9 "${APP_ID}" 0 ${FAIL}
  ReadRegStr $9 SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "DBArkOwnerPath"
  IfErrors ${FAIL}
  StrCmpS $9 $0 0 ${FAIL}
  ReadRegDWORD $9 SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "DBArkOwnerVersion"
  IfErrors ${FAIL}
  StrCmpS $9 1 0 ${FAIL}
  ReadRegStr $9 SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" ""
  IfErrors ${FAIL}
  StrCmpS $9 "${DBARK_OBJECT_URI_DESCRIPTION}" 0 ${FAIL}
  ReadRegStr $9 SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "URL Protocol"
  IfErrors ${FAIL}
  StrCmpS $9 "" 0 ${FAIL}
  ReadRegStr $9 SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\DefaultIcon" ""
  IfErrors ${FAIL}
  StrCmpS $9 '"$0",0' 0 ${FAIL}
  ReadRegStr $9 SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\shell" ""
  IfErrors ${FAIL}
  StrCmpS $9 "open" 0 ${FAIL}
  ReadRegStr $9 SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\shell\open\command" ""
  IfErrors ${FAIL}
  StrCmpS $9 $1 0 ${FAIL}
!macroend

!macro customInstall
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  StrCpy $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  StrCpy $1 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro DBArkObjectUriContext install dbark_uri_install_skip
  !insertmacro DBArkObjectUriOpen "${DBARK_OBJECT_URI_KEY}"
  StrCmpS $5 2 dbark_uri_register
  StrCmpS $5 0 0 dbark_uri_install_skip
  System::Call 'advapi32::RegCloseKey(p r3) i .r8'
  StrCmpS $8 0 0 dbark_uri_install_skip
  !insertmacro DBArkObjectUriOwned dbark_uri_install_skip
  dbark_uri_register:
    ClearErrors
    WriteRegStr SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "" "${DBARK_OBJECT_URI_DESCRIPTION}"
    WriteRegStr SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "URL Protocol" ""
    WriteRegStr SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\DefaultIcon" "" '"$0",0'
    WriteRegStr SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\shell" "" "open"
    WriteRegStr SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\shell\open\command" "" $1
    WriteRegStr SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "DBArkOwner" "${APP_ID}"
    WriteRegStr SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "DBArkOwnerPath" $0
    WriteRegDWORD SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "DBArkOwnerVersion" 1
    IfErrors dbark_uri_install_skip
    !insertmacro DBArkObjectUriOwned dbark_uri_install_skip
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0) v'
    DetailPrint "已注册DBArk对象链接。"
    Goto dbark_uri_install_done
  dbark_uri_install_skip:
    DetailPrint "DBArk对象链接注册未更改：已有外来或变化的处理程序，或无法确认注册写入。"
  dbark_uri_install_done:
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  StrCpy $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  StrCpy $1 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro DBArkObjectUriContext uninstall dbark_uri_uninstall_skip
  !insertmacro DBArkObjectUriOwned dbark_uri_uninstall_skip
  ; 只删除已核对的自有值，叶子仅空时移除；绝不递归删除Classes或dbark树。
  DeleteRegValue SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\shell\open\command" ""
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}\shell\open\command" 0 0 dbark_uri_uninstall_skip
  DeleteRegKey /ifempty SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\shell\open\command"
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}\shell\open" 0 0 dbark_uri_uninstall_skip
  DeleteRegKey /ifempty SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\shell\open"
  DeleteRegValue SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\shell" ""
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}\shell" 0 0 dbark_uri_uninstall_skip
  DeleteRegKey /ifempty SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\shell"
  DeleteRegValue SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\DefaultIcon" ""
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}\DefaultIcon" 0 0 dbark_uri_uninstall_skip
  DeleteRegKey /ifempty SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}\DefaultIcon"
  DeleteRegValue SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" ""
  DeleteRegValue SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "URL Protocol"
  DeleteRegValue SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "DBArkOwner"
  DeleteRegValue SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "DBArkOwnerPath"
  DeleteRegValue SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}" "DBArkOwnerVersion"
  !insertmacro DBArkObjectUriShape "${DBARK_OBJECT_URI_KEY}" 0 0 dbark_uri_uninstall_skip
  DeleteRegKey /ifempty SHELL_CONTEXT "${DBARK_OBJECT_URI_KEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0) v'
  Goto dbark_uri_uninstall_done
  dbark_uri_uninstall_skip:
    DetailPrint "保留dbark对象链接：注册已不属于本安装，或无法确认完整所有权。"
  dbark_uri_uninstall_done:
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
