; "Open in Gear" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInGear" "" "Open in Gear"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInGear" "Icon" '"$INSTDIR\Gear.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInGear" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInGear\command" "" '"$INSTDIR\Gear.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInGear" "" "Open in Gear"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInGear" "Icon" '"$INSTDIR\Gear.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInGear" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInGear\command" "" '"$INSTDIR\Gear.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInGear" "" "Open in Gear"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInGear" "Icon" '"$INSTDIR\Gear.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInGear" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInGear\command" "" '"$INSTDIR\Gear.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInGear"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInGear"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInGear"
!macroend
