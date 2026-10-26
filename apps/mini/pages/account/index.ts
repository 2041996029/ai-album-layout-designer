import { createNativePage } from "../../src/native-page";
import { createAccountPage } from "../../src/account-page";
if (typeof Page === "function") Page(createNativePage(createAccountPage));
