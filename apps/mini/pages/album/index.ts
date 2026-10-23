export * from "../../src/album";
import { createAlbumPage } from "../../src/album-page";
import { createNativePage } from "../../src/native-page";
if (typeof Page === "function") Page(createNativePage(createAlbumPage));
