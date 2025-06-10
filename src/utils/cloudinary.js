import {v2 as cloudinary} from 'cloudinary'
import fs from "fs"

 cloudinary.config({ 
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
        api_key: process.env.CLOUDINARY_API_KEY, 
        api_secret: process.env.CLOUDINARY_API_SECRET // Click 'View API Keys' above to copy your API secret
    });


    const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) return null
        //upload the file on cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto"
        })
        // file has been uploaded successfull
        // console.log("file is uploaded on cloudinary ", response.url);
        // fs.unlinkSync(localFilePath)
        if (fs.existsSync(localFilePath)) { fs.unlinkSync(localFilePath); } 
        return response;

    } catch (error) {
        console.error("Cloudinary: UPLOAD FAILED! Error details:", error);
        fs.unlinkSync(localFilePath) // remove the locally saved temporary file as the upload operation got failed
        return null;
    }
}

const deleteFromCloudinary = async (publicId, resourceType) => {
    try {
        if (!publicId) return null;
        const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        return result;
    } catch (error) {
        console.error(`Cloudinary: ERROR deleting asset with public ID ${publicId}:`, error);
        return null;
    }
};

export {uploadOnCloudinary, deleteFromCloudinary}