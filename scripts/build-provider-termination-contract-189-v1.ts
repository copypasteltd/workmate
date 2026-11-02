import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {providerEvidenceDocument, providerEvidenceCreate} from '../src/provider-admin-model.js';

const source='contracts/provider-admin-schemas.json';
const bytes=await readFile(source);
const contract={
  version:189,
  scope:'Additive termination-only evidence input. Other provider administration contracts retain their original scope.',
  baseline:{path:source,sha256:createHash('sha256').update(bytes).digest('hex')},
  semantics:{
    purpose:'termination_only',
    capacity:'A bound terminal request may be released through the existing authorized preview and operation flow.',
    accounting:'Null billed amount and omitted usage quantities remain unknown. This document cannot authorize cost reconciliation, a zero charge or release of financial holds.',
    access:'The highest administrator may execute directly with recent MFA and complete audit. Other roles retain current permissions, scopes and approval policy.',
    schema_migration_required:false,
  },
  schemas:{
    ProviderEvidenceDocument:z.toJSONSchema(providerEvidenceDocument,{io:'input'}),
    ProviderEvidenceCreate:z.toJSONSchema(providerEvidenceCreate,{io:'input'}),
  },
};
await writeFile('contracts/provider-termination-189-v1-schemas.json',JSON.stringify(contract,null,2)+'\n',{flag:'wx'});
