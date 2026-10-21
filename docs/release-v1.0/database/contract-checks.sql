-- Isolated SQL constraint checks, NOT API/provider/worker integration tests.
-- Requires freshly applied 001_initial.up.sql. All fixture rows ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path TO ai_album, pg_catalog;
SET LOCAL TIME ZONE 'UTC';
CREATE FUNCTION pg_temp.expect_error(statement text, expected_state text, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    IF actual_state <> expected_state THEN
      RAISE EXCEPTION '%: expected %, got %', label, expected_state, actual_state;
    END IF;
    RAISE NOTICE 'PASS: % [%]', label, actual_state;
    RETURN;
  END;
  RAISE EXCEPTION '%: statement unexpectedly succeeded', label;
END;
$$;
SELECT pg_temp.expect_error($q$SELECT ''::opaque_id$q$,'23514','empty opaque id');
SELECT pg_temp.expect_error($q$SELECT repeat('x',129)::opaque_id$q$,'23514','129 character id');
SELECT pg_temp.expect_error($q$SELECT (-1)::safe_uint$q$,'23514','negative unsigned amount');
SELECT pg_temp.expect_error($q$SELECT 9007199254740992::safe_uint$q$,'23514','unsafe JSON integer');
SELECT pg_temp.expect_error($q$SELECT upper(repeat('a',64))::sha256_hex$q$,'23514','noncanonical SHA256');
INSERT INTO users(id,display_name) VALUES ('u1','Local One'),('u2','Local Two');
INSERT INTO workspaces(id,owner_user_id,kind,name) VALUES ('w1','u1','personal','One'),('w2','u2','studio','Two');
INSERT INTO asset_folders(id,workspace_id,name,normalized_name,created_by) VALUES ('f1','w1','Photos','photos','u1');
SELECT pg_temp.expect_error($q$INSERT INTO asset_folders(id,workspace_id,parent_id,name,normalized_name,created_by) VALUES ('f2','w2','f1','Child','child','u2')$q$,'23503','cross workspace folder parent');
SELECT pg_temp.expect_error($q$INSERT INTO asset_folders(id,workspace_id,name,normalized_name,created_by) VALUES ('f2','w1','PHOTOS','photos','u1')$q$,'23505','virtual root duplicate normalized name');
SELECT pg_temp.expect_error($q$INSERT INTO asset_folders(id,workspace_id,name,normalized_name,created_by) VALUES ('f2','w1','../x','../x','u1')$q$,'23514','invalid folder name');
SELECT pg_temp.expect_error($q$UPDATE asset_folders SET workspace_id='w2' WHERE id='f1'$q$,'23514','stable workspace owner');
INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES ('secret_dev','dev','secret://local-fixture','v1','test');
INSERT INTO storage_profiles(id,environment,name) VALUES ('sp_dev','dev','Local'),('sp_prod','prod','Local');
INSERT INTO storage_profile_versions(id,profile_id,version,environment,provider,adapter_version,region,endpoint,bucket,base_prefix,secret_reference_id,encryption_mode) VALUES ('spv1','sp_dev',1,'dev','s3','test','test','https://example.invalid','fixture','private','secret_dev','providerManaged');
SELECT pg_temp.expect_error($q$INSERT INTO storage_profile_versions(id,profile_id,version,environment,provider,adapter_version,region,endpoint,bucket,base_prefix,secret_reference_id,encryption_mode) VALUES ('spv2','sp_prod',1,'prod','s3','test','test','https://example.invalid','fixture','private','secret_dev','providerManaged')$q$,'23503','cross environment secret reference');
INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state) VALUES
 ('obj1','w1','spv1','fixture','w1/source','original',repeat('a',64),100,'image/jpeg','verified'),
 ('obj2','w2','spv1','fixture','w2/source','original',repeat('b',64),100,'image/jpeg','verified'),
 ('doc1','w1','spv1','fixture','w1/document','document',repeat('c',64),100,'application/json','verified'),
 ('output1','w1','spv1','fixture','w1/output','export',repeat('d',64),100,'application/json','verified');
SELECT pg_temp.expect_error($q$UPDATE storage_objects SET object_key='new-path' WHERE id='obj1'$q$,'23514','pinned locator immutable');
INSERT INTO assets(id,workspace_id,original_filename,byte_size,mime_type,origin) VALUES ('a1','w1','photo.jpg',100,'image/jpeg','upload');
UPDATE assets SET original_object_id='obj1',sha256=repeat('a',64),width=10,height=10,state='ready',revision=revision+1 WHERE id='a1';
SELECT pg_temp.expect_error($q$UPDATE assets SET width=11 WHERE id='a1'$q$,'23514','ready asset bytes immutable');
SELECT pg_temp.expect_error($q$INSERT INTO assets(id,workspace_id,original_object_id,original_filename,sha256,byte_size,width,height,mime_type,origin,state) VALUES ('a2','w2','obj1','x.jpg',repeat('a',64),100,10,10,'image/jpeg','upload','ready')$q$,'23503','cross workspace asset object');
SELECT pg_temp.expect_error($q$INSERT INTO assets(id,workspace_id,original_filename,byte_size,mime_type,origin,state) VALUES ('a2','w1','x.jpg',100,'image/jpeg','upload','ready')$q$,'23514','ready asset requires decoded facts');
SELECT pg_temp.expect_error($q$INSERT INTO assets(id,workspace_id,original_filename,byte_size,width,height,mime_type,origin) VALUES ('a2','w1','x.jpg',100,10000,10000,'image/jpeg','upload')$q$,'23514','80 megapixel source bound');
INSERT INTO projects(id,workspace_id,name,created_by,current_revision) VALUES ('p1','w1','Local','u1',1);
INSERT INTO project_revisions(id,workspace_id,project_id,number,schema_version,storage_object_id,document_hash,spread_count,photo_count,created_by,command_id,base_revision) VALUES ('r1','w1','p1',1,1,'doc1',repeat('c',64),1,1,'u1','cmd1',0);
SELECT pg_temp.expect_error($q$UPDATE project_revisions SET photo_count=2 WHERE id='r1'$q$,'23514','immutable revision update');
SELECT pg_temp.expect_error($q$DELETE FROM project_revisions WHERE id='r1'$q$,'23514','immutable revision delete');
SELECT pg_temp.expect_error($q$INSERT INTO project_revisions(id,workspace_id,project_id,number,schema_version,storage_object_id,document_hash,spread_count,photo_count,created_by,command_id,base_revision) VALUES ('r2','w1','p1',1,1,'doc1',repeat('c',64),1,1,'u1','cmd2',0)$q$,'23505','project revision number unique');
INSERT INTO export_preflights(id,workspace_id,project_id,revision_id,normalized_spec_hash,schema_version,format,dpi,max_face_pixels,warnings,blockers,token_hash,expires_at) VALUES ('preflight_jpeg','w1','p1','r1',repeat('a',64),1,'jpeg',300,100,'[]','[]',repeat('a',64),now()+interval '5 minutes');
SELECT pg_temp.expect_error($q$INSERT INTO export_preflights(id,workspace_id,project_id,revision_id,normalized_spec_hash,schema_version,format,dpi,max_face_pixels,warnings,blockers,token_hash,expires_at) VALUES ('preflight_jpg','w1','p1','r1',repeat('a',64),1,'jpg',300,100,'[]','[]',repeat('b',64),now()+interval '5 minutes')$q$,'23514','preflight canonical jpeg enum rejects jpg');
SELECT pg_temp.expect_error($q$INSERT INTO export_preflights(id,workspace_id,project_id,revision_id,normalized_spec_hash,schema_version,format,dpi,max_face_pixels,warnings,blockers,token_hash,expires_at) VALUES ('preflight_zip','w1','p1','r1',repeat('a',64),1,'zip',300,100,'[]','[]',repeat('b',64),now()+interval '5 minutes')$q$,'23514','zip is a package output not exportOptions format');
INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES ('release1','dev',1,1,repeat('e',64),'{}','u1');
SELECT pg_temp.expect_error($q$UPDATE config_releases SET manifest='{"changed":true}' WHERE id='release1'$q$,'23514','immutable config release');
SELECT pg_temp.expect_error($q$INSERT INTO config_active_releases(id,environment,release_id) VALUES ('active_prod','prod','release1')$q$,'23503','active release environment');
INSERT INTO job_snapshots(id,workspace_id,kind,project_id,revision_id,config_release_id,schema_version,normalized_spec_hash,manifest_hash,manifest,entitlement_snapshot,warnings_acknowledged) VALUES
 ('snap1','w1','layout','p1','r1','release1',1,repeat('a',64),repeat('b',64),'{}','{}','[]'),
 ('snap2','w1','layout','p1','r1','release1',1,repeat('a',64),repeat('b',64),'{}','{}','[]');
INSERT INTO jobs(id,workspace_id,kind,snapshot_id,created_by) VALUES ('job1','w1','layout','snap1','u1'),('job2','w1','layout','snap2','u1');
SELECT pg_temp.expect_error($q$INSERT INTO jobs(id,workspace_id,kind,snapshot_id,created_by,state,terminal_at) VALUES ('forged','w1','layout','snap1','u1','succeeded',now())$q$,'23514','new job cannot start terminal');
SELECT pg_temp.expect_error($q$UPDATE jobs SET state='running' WHERE id='job1'$q$,'23514','job CAS revision required');
SELECT pg_temp.expect_error($q$UPDATE jobs SET state='succeeded',terminal_at=now(),revision=revision+1 WHERE id='job1'$q$,'23514','queued cannot jump to success');
UPDATE jobs SET state='running',fence=1,attempt_count=attempt_count+1,revision=revision+1,lease_owner='worker1',lease_expires_at=now()+interval '1 hour' WHERE id IN ('job1','job2');
SELECT pg_temp.expect_error($q$UPDATE jobs SET fence=fence+1,revision=revision+1 WHERE id='job1'$q$,'23514','running worker cannot mint a new fence');
SELECT pg_temp.expect_error($q$INSERT INTO job_outputs(id,workspace_id,job_id,artifact_index,storage_object_id,committed_fence,format,sha256,byte_size,expires_at) VALUES ('out_bad','w1','job1',0,'output1',2,'json',repeat('d',64),100,now()+interval '1 day')$q$,'23514','stale output fence');
INSERT INTO job_outputs(id,workspace_id,job_id,artifact_index,storage_object_id,committed_fence,format,sha256,byte_size,expires_at) VALUES ('out1','w1','job1',0,'output1',1,'json',repeat('d',64),100,now()+interval '1 day');
INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state) VALUES
 ('jpeg1','w1','spv1','fixture','w1/jpeg-output','export',repeat('e',64),100,'image/jpeg','verified'),
 ('archive1','w1','spv1','fixture','w1/archive-output','export',repeat('f',64),100,'application/zip','verified');
INSERT INTO job_outputs(id,workspace_id,job_id,artifact_index,storage_object_id,committed_fence,format,sha256,byte_size,width,height,expires_at) VALUES ('out_jpeg','w1','job1',1,'jpeg1',1,'jpeg',repeat('e',64),100,10,10,now()+interval '1 day');
INSERT INTO job_outputs(id,workspace_id,job_id,artifact_index,storage_object_id,committed_fence,format,sha256,byte_size,expires_at) VALUES ('out_zip','w1','job1',2,'archive1',1,'zip',repeat('f',64),100,now()+interval '1 day');
SELECT pg_temp.expect_error($q$INSERT INTO job_outputs(id,workspace_id,job_id,artifact_index,storage_object_id,committed_fence,format,sha256,byte_size,expires_at) VALUES ('out_jpg','w1','job1',3,'jpeg1',1,'jpg',repeat('e',64),100,now()+interval '1 day')$q$,'23514','job output canonical jpeg enum rejects jpg');
UPDATE jobs SET state='succeeded',terminal_at=now(),revision=revision+1,lease_owner=NULL,lease_expires_at=NULL WHERE id='job1';
SELECT pg_temp.expect_error($q$UPDATE jobs SET state='cancelled',revision=revision+1 WHERE id='job1'$q$,'23514','success wins cancel race');
SELECT pg_temp.expect_error($q$INSERT INTO job_outputs(id,workspace_id,job_id,artifact_index,storage_object_id,committed_fence,format,sha256,byte_size,expires_at) VALUES ('out_late','w1','job1',1,'output1',1,'json',repeat('d',64),100,now()+interval '1 day')$q$,'23514','late output after terminal');
UPDATE jobs SET state='cancel_requested',cancel_requested_at=now(),revision=revision+1 WHERE id='job2';
SELECT pg_temp.expect_error($q$UPDATE jobs SET state='succeeded',terminal_at=now(),revision=revision+1 WHERE id='job2'$q$,'23514','cancel wins success race');
UPDATE jobs SET state='cancelled',terminal_at=now(),revision=revision+1,lease_owner=NULL,lease_expires_at=NULL WHERE id='job2';
INSERT INTO billing_skus(id,code,name) VALUES ('sku1','local','Local fixture');
INSERT INTO sku_versions(id,sku_id,version,price_fen,duration_days,credit_grant,features) VALUES ('skuv1','sku1',1,100,30,100,'{}');
INSERT INTO orders(id,workspace_id,sku_version_id,buyer_user_id,amount_fen,channel,client_platform,expires_at) VALUES ('order1','w1','skuv1','u1',100,'wechat_pay','web',now()+interval '1 hour');
INSERT INTO entitlement_grants(id,workspace_id,source_order_id,grant_type,starts_at,ends_at,features) VALUES ('grant1','w1','order1','credits',now(),now()+interval '30 days','{}');
SELECT pg_temp.expect_error($q$INSERT INTO entitlement_grants(id,workspace_id,source_order_id,grant_type,starts_at,ends_at,features) VALUES ('grant2','w1','order1','credits',now(),now()+interval '30 days','{}')$q$,'23505','one fulfillment grant per order type');
INSERT INTO credit_lots(id,workspace_id,source_grant_id,granted,available,expires_at) VALUES ('lot1','w1','grant1',100,100,now()+interval '30 days');
SELECT pg_temp.expect_error($q$UPDATE credit_lots SET reserved=1 WHERE id='lot1'$q$,'23514','lot conservation');
INSERT INTO credit_ledger(id,workspace_id,operation_id,operation_group_id,lot_id,entry_type,amount,from_bucket,to_bucket,balance_after,reason_code) VALUES ('ledger1','w1','op1','group1','lot1','grant',100,'external','available',100,'test_fixture');
SELECT pg_temp.expect_error($q$INSERT INTO credit_ledger(id,workspace_id,operation_id,operation_group_id,lot_id,entry_type,amount,from_bucket,to_bucket,balance_after,reason_code) VALUES ('ledger2','w1','op1','group2','lot1','grant',100,'external','available',100,'test_fixture')$q$,'23505','global ledger operation dedupe');
SELECT pg_temp.expect_error($q$UPDATE credit_ledger SET amount=99 WHERE id='ledger1'$q$,'23514','append ledger update');
SELECT pg_temp.expect_error($q$DELETE FROM credit_ledger WHERE id='ledger1'$q$,'23514','append ledger delete');
SELECT pg_temp.expect_error($q$INSERT INTO credit_ledger(id,workspace_id,operation_id,operation_group_id,lot_id,entry_type,amount,from_bucket,to_bucket,balance_after,reason_code) VALUES ('ledger2','w1','op2','group2','lot1','settle',1,'available','consumed',99,'test_fixture')$q$,'23514','invalid ledger bucket transition');
INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,expires_at) VALUES ('idem1','w1','workspace','same-key',repeat('a',64),'local','processing',now()+interval '7 days');
SELECT pg_temp.expect_error($q$INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,expires_at) VALUES ('idem2','w1','workspace','same-key',repeat('b',64),'other-operation','processing',now()+interval '7 days')$q$,'23505','same scope idempotency key unique');
SELECT pg_temp.expect_error($q$INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,expires_at) VALUES ('idem2','w1','workspace','another-key',repeat('b',64),'local','processing',now()+interval '1 day')$q$,'23514','minimum seven day idempotency retention');
DO $$ BEGIN
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='ai_album' AND table_type='BASE TABLE') <> 92 THEN RAISE EXCEPTION 'expected 92 tables'; END IF;
  RAISE NOTICE 'PASS: 92 tables present, valid upload finalization and output publication succeeded';
END $$;
ROLLBACK;
