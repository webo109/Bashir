import { getTodayEmails, getAccounts } from "../lib/queries";

async function main() {
  const accts = await getAccounts();
  console.log(`accounts: ${accts.length}`);
  const today = await getTodayEmails();
  console.log(`today emails: ${today.length}`);
  if (today[0]) console.log("sample:", today[0]);
}
main().catch((e) => { console.error(e); process.exit(1); });
