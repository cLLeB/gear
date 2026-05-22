# gear-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _gear_user_zdotdir="${GEAR_USER_ZDOTDIR:-$HOME}"
  [ -f "$_gear_user_zdotdir/.zprofile" ] && source "$_gear_user_zdotdir/.zprofile"
  unset _gear_user_zdotdir
}
:
