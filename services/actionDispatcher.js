// services/actionDispatcher.js
import { ACTIONS } from "./actions.js";
import Branch from "../models/branch.js";
import { requireRole } from "./roleGuard.js";


// ⛔ DO NOT import Meta UI here
// ⛔ DO NOT import Twilio UI here
// ✅ ONLY business/session logic

export async function dispatchAction({
  action,
  biz,
  providerId,
  req,
  res,
  helpers
}) {
  const {
    saveBiz,
    resetSession,
    sendMenuForUser,
    sendTwimlText
  } = helpers;

  switch (action) {
    case ACTIONS.MENU:
      await resetSession(biz);
      return sendMenuForUser(res, biz, providerId);

    case ACTIONS.NEW_INVOICE:
      biz.sessionState = "creating_invoice_choose_client";
      biz.sessionData = { docType: "invoice", items: [] };
      await saveBiz(biz);
      return sendTwimlText(
        res,
        "Invoice:\n1) Use saved client\n2) New client\n3) Cancel"
      );

    case ACTIONS.ADD_CLIENT:
      biz.sessionState = "adding_client_name";
      biz.sessionData = {};
      await saveBiz(biz);
      return sendTwimlText(res, "Enter client name:");

    case ACTIONS.RECORD_PAYMENT:
      biz.sessionState = "payment_start";
      biz.sessionData = {};
      await saveBiz(biz);
      return res.redirect(307, req.originalUrl);


case ACTIONS.ASSIGN_BRANCH_USERS: {
  const users = await UserRole.find({
    businessId: biz._id,
    pending: false
  }).lean();

  if (!users.length) {
    return sendTwimlText(res, "No active users yet.");
  }

  biz.sessionState = "assign_branch_pick_user";
  biz.sessionData.users = users;
  await saveBiz(biz);

  return sendList(
    providerId,
    "Select user",
    users.map(u => ({
      id: `assign_user_${u._id}`,
      title: u.phone
    }))
  );
}



    case ACTIONS.REPORTS_MENU:
      biz.sessionState = "reports_menu";
      await saveBiz(biz);
      return res.redirect(307, req.originalUrl);

    case ACTIONS.UPGRADE:
      biz.sessionState = "upgrade_choose_package";
      await saveBiz(biz);
      return res.redirect(307, req.originalUrl);

      case ACTIONS.INVITE_USER: {
  // 🔒 Owner-only
  const ok = await requireRole(biz, providerId, ["owner"]);
  if (!ok) {
    return sendTwimlText(res, "⛔ Only the owner can invite users.");
  }

  const branches = await Branch.find({ businessId: biz._id }).lean();

  if (!branches.length) {
    return sendTwimlText(res, "No branches found. Add a branch first.");
  }

  // 🚀 START INVITE FLOW (THIS IS THE KEY FIX)
  biz.sessionData.branches = branches;
  biz.sessionState = "assign_user_choose_branch";
  await saveBiz(biz);

  let msg = "Select branch for new user:\n";
  branches.forEach((b, i) => {
    msg += `${i + 1}) ${b.name}\n`;
  });
  msg += "0) Cancel";

  return sendTwimlText(res, msg);
}


    case ACTIONS.CANCEL:
    case ACTIONS.BACK:
      await resetSession(biz);
      return sendMenuForUser(res, biz, providerId);

    default:
      return sendTwimlText(res, "Unknown action. Reply *menu*.");
  }
}
