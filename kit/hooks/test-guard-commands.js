const { execFileSync } = require('child_process');
const GUARD = process.env.USERPROFILE + '\\.claude\\hooks\\guard-commands.js';

const cases = [
  // [name, command, cwd, expected]
  ['force push',            'git push --force origin main',            'C:\\GitHub\\wsbc-services', 'DENY'],
  ['force push -f',         'git push -f',                             'C:\\GitHub\\wsbc-services', 'DENY'],
  ['force-with-lease',      'git push --force-with-lease',             'C:\\GitHub\\wsbc-services', 'DENY'],
  ['commit --amend',        'git commit --amend -m "x"',               'C:\\GitHub\\wsbc-services', 'DENY'],
  ['force push -C path',    'git -C /c/repo push -f origin x',         'C:\\GitHub\\wsbc-services', 'DENY'],
  ['force push -uf',        'git push -uf origin x',                   'C:\\GitHub\\wsbc-services', 'DENY'],
  ['force push +refspec',   'git push origin +main',                   'C:\\GitHub\\wsbc-services', 'DENY'],
  ['force push after &&',   'cd /c/repo && git push --force',          'C:\\GitHub\\wsbc-services', 'DENY'],
  ['amend after &&',        'git add x && git commit --amend --no-edit', 'C:\\GitHub\\wsbc-services', 'DENY'],

  // Regression: "push" / "--force" / "--amend" as TEXT (commit messages, heredoc bodies,
  // other commands' args) is not a force push. Blocked real commits on 2026-09-29.
  ['commit -F msg + push txt', 'git add x && git commit -q -F m.txt && echo "never push"', 'C:\\GitHub\\wsbc-services', 'allow'],
  ['commit -m mentions -f', 'git commit -m "never push -f or --force"', 'C:\\GitHub\\wsbc-services', 'allow'],
  ['commit -m mentions amend', 'git commit -m "prefer new commits to --amend"', 'C:\\GitHub\\wsbc-services', 'allow'],
  ['heredoc commit msg',    "git commit -F - <<'EOF'\nNever push --force; never git push -f.\nEOF", 'C:\\GitHub\\wsbc-services', 'allow'],
  ['heredoc to file',       "cat >> notes.md <<'EOF'\n- git push --force is blocked; use git add -A never; -F\nEOF", 'C:\\GitHub', 'allow'],
  ['ps here-string',        "git commit -m @'\nnever git push --force\n'@", 'C:\\GitHub\\wsbc-services', 'allow'],
  ['grep -F push in log',   'git log --format=%s | grep -F push',      'C:\\GitHub\\wsbc-services', 'allow'],
  ['gh pr --reviewer',      'gh pr create --title x --reviewer bob',   'C:\\GitHub\\wsbc-services', 'DENY'],
  ['curl PR w/ reviewers',  'curl -X POST https://bb/rest/api/1.0/projects/TWS/repos/x/pull-requests -d \'{"reviewers":[{"user":{"name":"t1"}}]}\'', 'C:\\GitHub\\wsbc-src', 'DENY'],
  ['ENV=prod make apply',   'ENV=prod AUTO=true make apply',           'C:\\GitHub\\thcp-wsbc-infrastructure-prod', 'DENY'],
  ['make apply-partial dr', 'ENV=dr make apply-partial',               'C:\\GitHub\\thcp-wsbc-infrastructure-dr', 'DENY'],
  ['make destroy-all prod', 'ENV=prod AUTO=true make destroy-all',     'C:\\GitHub\\thcp-wsbc-infrastructure-prod', 'DENY'],
  ['terraform apply dr',    'terraform apply -auto-approve',           'C:\\GitHub\\thcp-wsbc-infrastructure-dr', 'DENY'],
  // Branch-independent: Rule 1 denies `push ... main` in a shared KG whatever branch is
  // checked out. The old form asserted a commit on main at a path that is not in the
  // registry (`nlchi-kg`; the real one is Health-iEHR-NLHS-KG), so it never fired.
  ['push main in shared KG', 'git push origin main',                   'C:\\GitHub\\Health-iEHR-NLHS-KG', 'DENY'],

  ['plain ls',              'ls -la',                                  'C:\\GitHub', 'allow'],
  ['mvn package',           'mvn clean package',                       'C:\\GitHub\\wsbc-services', 'allow'],
  ['normal push',           'git push origin dev',                     'C:\\GitHub\\wsbc-services', 'allow'],
  ['normal commit',         'git commit -m "feat: x"',                 'C:\\GitHub\\wsbc-services', 'allow'],
  ['commit on kg/aslam',    'git commit -m "add doc"',                 'C:\\GitHub\\wsbc-pp-kg', 'allow'],
  ['local-kg on main',      'git commit -m "notes"',                   'C:\\GitHub\\local-kg', 'allow'],
  ['gh pr no reviewer',     'gh pr create --title x --body y',         'C:\\GitHub\\wsbc-services', 'allow'],
  ['curl PR no reviewers',  'curl -X POST https://bb/rest/api/1.0/projects/TWS/repos/x/pull-requests -d \'{"title":"x"}\'', 'C:\\GitHub\\wsbc-src', 'allow'],
  ['ENV=devqa make apply',  'ENV=devqa AUTO=true make apply',          'C:\\GitHub\\thcp-wsbc-infrastructure-dev', 'allow'],
  ['make plan prod',        'ENV=prod make plan',                      'C:\\GitHub\\thcp-wsbc-infrastructure-prod', 'allow'],
  ['make build-push dev',   'make build-push',                         'C:\\GitHub\\thcp-wsbc-infrastructure-dev', 'allow'],
  ['git status in shared KG','git status',                             'C:\\GitHub\\Health-iEHR-NLHS-KG', 'allow'],

  // --- Rule 5: state-changing cloud CLI calls ask; reads pass through -------------
  ['gcloud fw delete',      'gcloud compute firewall-rules delete allow-all --project th-worksafebc-prod-1326', 'C:\\GitHub', 'ASK'],
  ['gcloud secret add',     'gcloud secrets versions add wsbc-ldap-pw --data-file=-', 'C:\\GitHub', 'ASK'],
  ['gcloud iam binding',    'gcloud projects add-iam-policy-binding th-worksafebc-prod-1326 --member=user:x --role=roles/owner', 'C:\\GitHub', 'ASK'],
  ['gcloud policy create',  'gcloud alpha monitoring policies create --policy-from-file=p.json', 'C:\\GitHub', 'ASK'],
  ['gcloud run update',     'gcloud run services update wsbc-doc --region us-central1', 'C:\\GitHub', 'ASK'],
  ['aws put policy',        'aws s3api put-bucket-policy --bucket b --policy p', 'C:\\GitHub', 'ASK'],
  ['az vm delete',          'az vm delete --name wsbc-vm --yes',       'C:\\GitHub', 'ASK'],
  ['bq mk table',           'bq mk --table proj:ds.tbl',               'C:\\GitHub', 'ASK'],
  ['bq DELETE dml',         'bq query --use_legacy_sql=false "DELETE FROM ds.t WHERE 1=1"', 'C:\\GitHub', 'ASK'],

  ['gcloud list',           'gcloud compute instances list',           'C:\\GitHub', 'allow'],
  ['gcloud describe',       'gcloud compute instances describe hcsp12sql --zone us-central1-a', 'C:\\GitHub', 'allow'],
  ['gcloud logging read',   'gcloud logging read "resource.type=gce_instance" --freshness=1h', 'C:\\GitHub', 'allow'],
  ['gcloud get-iam-policy', 'gcloud projects get-iam-policy th-worksafebc-prod-1326', 'C:\\GitHub', 'allow'],
  ['gcloud secrets list',   'gcloud secrets versions list wsbc-ldap-pw', 'C:\\GitHub', 'allow'],
  ['gcloud access token',   'gcloud auth print-access-token',          'C:\\GitHub', 'allow'],
  ['gcloud config set',     'gcloud config set project th-worksafebc-dev-1234', 'C:\\GitHub', 'allow'],
  ['gcloud delete --help',  'gcloud compute firewall-rules delete --help', 'C:\\GitHub', 'allow'],

  // Regression: `patch` inside a resource/group NAME (wsbc-vm-patch-runner,
  // patch-jobs) is not a mutating verb - only `patch` as its own token is.
  ['patch-jobs list',       'gcloud compute os-config patch-jobs list --project th-worksafebc-dev-acfa', 'C:\\GitHub', 'allow'],
  ['describe patch runner', 'gcloud run jobs describe wsbc-vm-patch-runner --region northamerica-northeast1', 'C:\\GitHub', 'allow'],
  ['logging read patch',    'gcloud logging read \'resource.labels.job_name="wsbc-vm-patch-runner"\' --freshness=30d', 'C:\\GitHub', 'allow'],
  ['executions list',       'gcloud run jobs executions list --job wsbc-vm-patch-runner --region northamerica-northeast1', 'C:\\GitHub', 'allow'],
  ['os-inventory describe', 'gcloud compute instances os-inventory describe wsbc-dev-ws --zone northamerica-northeast1-a', 'C:\\GitHub', 'allow'],
  ['run job execute',       'gcloud run jobs execute wsbc-vm-patch-runner --region northamerica-northeast1', 'C:\\GitHub', 'ASK'],
  ['scheduler resume',      'gcloud scheduler jobs resume wsbc-vm-patch-monthly --location northamerica-northeast1', 'C:\\GitHub', 'ASK'],
  ['instances start',       'gcloud compute instances start wsbc-dev-web --zone northamerica-northeast1-a', 'C:\\GitHub', 'ASK'],
  ['set-machine-type',      'gcloud compute instances set-machine-type wsbc-dev-ws --machine-type n2-standard-4 --zone northamerica-northeast1-a', 'C:\\GitHub', 'ASK'],

  ['aws s3 ls',             'aws s3 ls',                               'C:\\GitHub', 'allow'],
  ['az vm list',            'az vm list --output table',               'C:\\GitHub', 'allow'],
  ['bq ls',                 'bq ls proj:ds',                           'C:\\GitHub', 'allow'],
  ['bq SELECT',             'bq query --use_legacy_sql=false "SELECT 1"', 'C:\\GitHub', 'allow'],
];

let pass = 0, fail = 0;
for (const [name, command, cwd, expected] of cases) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });
  let out = '';
  try {
    out = execFileSync('node', [GUARD], { input: payload, encoding: 'utf8' });
  } catch (e) {
    out = 'HARNESS-ERROR ' + e.message;
  }
  const got = /"permissionDecision":"deny"/.test(out) ? 'DENY'
            : /"permissionDecision":"ask"/.test(out) ? 'ASK'
            : 'allow';
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} expect=${expected.padEnd(5)} got=${got}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
