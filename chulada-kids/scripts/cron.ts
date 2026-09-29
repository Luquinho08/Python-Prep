/** Ejecuta las tareas programadas una vez (usar desde cron del sistema cada 5 minutos). */
import "dotenv/config";
import { sqlClient } from "../src/lib/db";
import { runAllJobs } from "../src/lib/jobs";

runAllJobs()
  .then(async (r) => {
    console.log(JSON.stringify(r));
    await sqlClient.end();
  })
  .catch(async (e) => {
    console.error(e);
    await sqlClient.end();
    process.exit(1);
  });
