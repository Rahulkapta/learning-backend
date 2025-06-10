import multer from "multer";

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "./public/temp")
    },
    filename: function (req, file, cb) {
      
      cb(null, file.originalname)
    }
  })
  
export const upload = multer({ 
    storage, 
    limits: {
        // Increase this limit for video files.
        // 100 * 1024 * 1024 = 100 MB
        // 200 * 1024 * 1024 = 200 MB
        // 500 * 1024 * 1024 = 500 MB
        // Choose a reasonable max size based on your needs and Cloudinary plan
        fileSize: 200 * 1024 * 1024 // Example: Set to 200 MB for videos
    }
})