# Product Images Folder (`product-images/`)

Place your own AICE ice cream product photos (`.jpg`, `.jpeg`, `.png`, or `.webp`, up to 5 MB each) in this folder on your computer.

## How to Load Product Photos into the System
1. Sign in as **Admin** (`admin_test` / `Test@1234` or `admin` / `Admin@1234`).
2. Register your first **Warehouse** on the **Warehouse Setup** page to unlock the system.
3. Open **Products & Categories** in the Admin sidebar.
4. Create a product category (e.g., *Stick*, *Cone*, *Cup*, *Mochi*).
5. Fill out the **Add Product** form (SKU, Name, Flavor, Size, Price) and click the **Product Photo** file picker to select your photo from `product-images/`.
6. Verify the **Live Image Preview**, then click **Save Product**.
   - Multer validates the file on the server (`JPG`, `PNG`, `WEBP`, max `5 MB`), saves it with a unique filename inside `server/uploads/products/`, and stores only the file path (`image_url`) in the `products` table.
   - If a product has no uploaded image, a neutral `"No image"` box is displayed across the entire system (never a stock photo, emoji, or fake image).
