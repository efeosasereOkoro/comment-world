/** Hidden page key used by the install verifier's live write-path test. Test
 *  comments are written here so they never render on a real page; the dashboard
 *  also filters this key out of the owner's comment list as a belt-and-suspenders
 *  guard in case post-test cleanup ever fails. */
export const INSTALL_CHECK_PAGE = "__commentbox_install_check__";
