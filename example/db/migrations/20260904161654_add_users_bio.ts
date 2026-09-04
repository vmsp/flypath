import { addColumn, migration } from "flypath/migrations";
import { text } from "flypath/schema";

export default migration([addColumn("users", "bio", text())]);
