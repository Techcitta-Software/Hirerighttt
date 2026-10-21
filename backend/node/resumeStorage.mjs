import { createClient } from '@supabase/supabase-js'

export function supabaseEnv() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).trim()
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim()
  const bucket = (process.env.SUPABASE_RESUME_BUCKET || 'resumes').trim()
  return { url, key, bucket }
}

export function supabaseStorageConfigured() {
  if (process.env.DISABLE_SUPABASE === 'true') return false
  const region = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim()
  const bucket = (process.env.S3_BUCKET || '').trim()
  if (region && bucket) return false
  const { url, key } = supabaseEnv()
  return Boolean(url && key)
}

/**
 * @param {{ candidateEmail: string, filename: string, buffer: Buffer, contentType?: string }} opts
 */
export async function uploadResumeToSupabase(opts) {
  const { url, key, bucket } = supabaseEnv()
  if (!url || !key) {
    const err = new Error('Supabase storage is not configured.')
    err.status = 503
    err.skipped = true
    throw err
  }

  const safeEmail = String(opts.candidateEmail || 'user')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
  const safeName = String(opts.filename || 'resume.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectPath = `${safeEmail}/${Date.now()}-${safeName}`

  const client = createClient(url, key, { auth: { persistSession: false } })
  const contentType = opts.contentType || 'application/octet-stream'
  const { error } = await client.storage.from(bucket).upload(objectPath, opts.buffer, {
    contentType,
    upsert: false,
  })
  if (error) {
    const err = new Error(error.message || 'Supabase upload failed')
    err.status = 502
    throw err
  }

  const { data: publicData } = client.storage.from(bucket).getPublicUrl(objectPath)
  return {
    storagePath: objectPath,
    resumeUrl: publicData?.publicUrl || `${url}/storage/v1/object/public/${bucket}/${objectPath}`,
    bucket,
  }
}
