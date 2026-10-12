# FlirtTime AWS Lambda Thumbnail Resizer

This AWS Lambda function automatically resizes images uploaded to your FlirtTime S3 bucket into optimized thumbnails and stores them under the `thumbnails/` prefix.

---

## 🎯 Architecture Flow

```
[Mobile App / Web App]
         │
         │ 1. Request presigned upload URL
         ▼
[FlirtTime Backend API]
   POST /api/v1/media/presigned-url
         │ Returns:
         │   uploadUrl: https://flirttime.s3.ap-south-1.amazonaws.com/uploads/...
         │   publicUrl: https://flirttime.s3.ap-south-1.amazonaws.com/uploads/...
         │   thumbnailUrl: https://flirttime.s3.ap-south-1.amazonaws.com/thumbnails/uploads/...
         ▼
[Client Uploads Directly to S3] (PUT uploadUrl)
         │
         │ 2. S3 ObjectCreated Event
         ▼
[AWS Lambda (flirttime-thumbnail-resizer)]
         │
         │ 3. Sharp resizes image to 400x400 (entropy-focused, progressive JPEG)
         ▼
[S3 Bucket: thumbnails/${key}]
```

---

## 🚀 Deployment Instructions (AWS Console)

### Step 1: Create the Lambda Function
1. Open the [AWS Lambda Console](https://console.aws.amazon.com/lambda).
2. Click **Create function**:
   - **Function name**: `flirttime-thumbnail-resizer`
   - **Runtime**: `Node.js 20.x`
   - **Architecture**: `x86_64` (or `arm64`)
   - **Execution role**: Create a new role with basic Lambda permissions.

### Step 2: Grant S3 Permissions to Lambda Role
Attach an IAM policy allowing the Lambda execution role to read and write to your S3 bucket:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

### Step 3: Configure Function Settings
- **Memory**: Set to **512 MB** or **1024 MB** (recommended for Sharp image processing speed).
- **Timeout**: Set to **15 seconds**.
- **Environment Variables**:
  - `THUMBNAIL_PREFIX`: `thumbnails` (default)
  - `THUMBNAIL_WIDTH`: `400`
  - `THUMBNAIL_HEIGHT`: `400`
  - `THUMBNAIL_QUALITY`: `80`

### Step 4: Package & Upload Code with Sharp
Since `sharp` uses native Linux binaries, install dependencies for Linux:
```bash
cd aws/lambda/thumbnail-resizer
npm install --arch=x64 --platform=linux sharp @aws-sdk/client-s3
# On Windows PowerShell or Linux, zip index.mjs and node_modules:
zip -r function.zip index.mjs node_modules package.json
```
Upload `function.zip` in the **Code Source** tab -> **Upload from** -> **.zip file**.

*(Alternatively, you can attach the public AWS Sharp Lambda Layer or Docker container).*

### Step 5: Add S3 Trigger
1. In your Lambda function, click **Add trigger**.
2. Select **S3**.
3. Bucket: Your FlirtTime S3 bucket (`flirttime` or your bucket name).
4. Event types: `All object create events` (`s3:ObjectCreated:*`).
5. **Prefix**: Set to `uploads/` (or leave empty to process `photos/` and `moments/` too).
6. **Suffix**: Leave blank or set to `.jpg` / `.png` / `.webp`.
7. **Important**: Ensure your trigger does NOT match `thumbnails/` to avoid loops. (The code also has a safeguard check `key.startsWith('thumbnails/')` to prevent any recursion).
