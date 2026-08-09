!macro customInstall
  ; The product identity stays the same for in-place upgrades, but the visible shortcut changed.
  ; Remove only the two exact legacy links after the new Deal Shark shortcuts are created.
  Delete "$DESKTOP\Discogs Deal Watcher.lnk"
  Delete "$SMPROGRAMS\Discogs Deal Watcher.lnk"
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Discogs Deal Watcher.lnk"
  Delete "$SMPROGRAMS\Discogs Deal Watcher.lnk"
!macroend
