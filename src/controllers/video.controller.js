import mongoose, { isValidObjectId } from "mongoose";
import { Video } from "../models/video.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  deleteFromCloudinary,
  uploadOnCloudinary,
} from "../utils/cloudinary.js";
import { Like } from "../models/like.model.js";
import { Comment } from "../models/comment.model.js";

const getAllVideos = asyncHandler(async (req, res) => {
  // 1. Extract Query Parameters
  const { page = 1, limit = 10, query, sortBy, sortType, userId } = req.query;
  // These lines destructure values from the request's query string (e.g., /videos?page=2&limit=5).
  // Default values are provided for `page` (1) and `limit` (10) if they are not present in the query.
  // `query` is for search terms, `sortBy` and `sortType` for sorting criteria, and `userId` for filtering by owner.

  const pipeline = [];
  // An empty array named `pipeline` is initialized. This array will hold the stages
  // of a MongoDB aggregation pipeline. Aggregation pipelines process documents
  // through a sequence of stages to produce computed results.

  // 2. Match Stage (Filtering)
  if (query) {
    // If a `query` parameter is provided, this stage is added to the pipeline.
    pipeline.push({
      $match: {
        // The $match stage filters documents to pass only those that match the specified condition(s)
        // to the next pipeline stage.
        $or: [
          // The $or operator performs a logical OR operation on an array of two or more <expression>s
          // and selects the documents that satisfy at least one of the <expression>s.
          { title: { $regex: query, $options: "i" } },
          // This matches documents where the 'title' field contains the 'query' string.
          // $regex provides regular expression capabilities.
          // $options: "i" makes the search case-insensitive.
          { description: { $regex: query, $options: "i" } },
          // This matches documents where the 'description' field contains the 'query' string, also case-insensitive.
        ],
      },
    });
  }

  if (userId) {
    // If a `userId` parameter is provided, this block executes.
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      // This is a crucial validation step. It checks if the provided `userId` string
      // is a valid MongoDB ObjectId format. If not, it throws an `ApiError`.
      throw new ApiError(400, "Invalid userId");
    }
    pipeline.push({
      $match: {
        // Matches documents where the 'owner' field (which stores the user's ObjectId)
        // is equal to the provided `userId`.
        owner: new mongoose.Types.ObjectId(userId), // Converts the string userId to a Mongoose ObjectId
      },
    });
  }

  // 3. Sort Stage
  if (sortBy && sortType) {
    // If both `sortBy` (e.g., 'createdAt', 'views', 'title') and `sortType` ('asc' or 'desc')
    // parameters are provided, this custom sort is applied.
    const sort = {};
    sort[sortBy] = sortType === "asc" ? 1 : -1;
    // Dynamically creates a sort object. E.g., if sortBy is 'createdAt' and sortType is 'desc',
    // 'sort' becomes { createdAt: -1 }. 1 for ascending, -1 for descending.
    pipeline.push({ $sort: sort });
    // The $sort stage reorders the documents based on the specified sort key and order.
  } else {
    // Default sorting if no specific sortBy/sortType is provided.
    pipeline.push({ $sort: { createdAt: -1 } });
    // Sorts videos by their creation date in descending order (newest first).
  }

  // 4. Pagination Stage
  pipeline.push({
    $skip: (page - 1) * limit,
    // The $skip stage skips a specified number of documents.
    // For example, if page=2 and limit=10, it skips (2-1)*10 = 10 documents,
    // effectively starting from the 11th document (for the second page).
  });
  pipeline.push({
    $limit: parseInt(limit),
    // The $limit stage restricts the number of documents passed to the next stage.
    // `parseInt(limit)` ensures that the limit is treated as a number.
  });

  // 5. Lookup Stage (Populate owner details)
  pipeline.push({
    $lookup: {
      // The $lookup stage performs a left outer join to an unsharded collection in the same database.
      // It joins documents from the 'videos' collection with documents from the 'users' collection.
      from: "users", // The collection to join with (MongoDB automatically pluralizes model names, so 'User' model becomes 'users' collection)
      localField: "owner", // The field from the 'videos' collection (the input documents)
      foreignField: "_id", // The field from the 'users' collection (the "foreign" documents)
      as: "ownerDetails", // The name of the new array field to add to the input documents.
      // This array will contain matching user documents.
      pipeline: [
        // An optional sub-pipeline to run on the joined collection.
        // This allows for filtering or projecting fields from the 'users' collection before joining.
        {
          $project: {
            username: 1, // Include username
            fullName: 1, // Include fullName
            avatar: 1, // Include avatar
            // Exclude _id by default, or explicitly set to 0 to exclude.
          },
        },
      ],
    },
  });

  pipeline.push({
    $unwind: {
      // The $unwind stage deconstructs an array field from the input documents to output a document for each element.
      // Since $lookup creates an array field (`ownerDetails`), this stage "unwinds" it.
      path: "$ownerDetails", // The array field to unwind
      preserveNullAndEmptyArrays: true,
      // If true, and the path is null, missing, or an empty array, $unwind outputs the document
      // without unwinding the path. This is important to ensure videos without a matching owner
      // (though rare if `owner` is required) are not filtered out.
    },
  });

  // 6. Project Stage (Select and reshape fields for final output)
  pipeline.push({
    $project: {
      // The $project stage reshapes each document in the stream, including, excluding, or renaming fields.
      _id: 1, // Include the video's _id
      title: 1, // Include title
      description: 1, // Include description
      videoFile: 1, // Include videoFile URL
      thumbnail: 1, // Include thumbnail URL
      duration: 1, // Include duration
      views: 1, // Include views count
      createdAt: 1, // Include creation timestamp
      owner: "$ownerDetails", // Reshape 'owner' to contain the object from `ownerDetails`
      // rather than just the ObjectId.
    },
  });

  // 7. Execute the Aggregation Pipeline
  const videos = await Video.aggregate(pipeline);
  // The `aggregate` method executes the defined pipeline on the `Video` model's collection.
  // It returns an array of documents that have passed through all stages.

  // 8. Send Response
  return res
    .status(200)
    .json(new ApiResponse(200, { videos }, "Videos fetched successfully"));
  // Returns a JSON response with a 200 status code.
  // It uses the `ApiResponse` utility to standardize the response format,
  // including the status code, the fetched `videos` data, and a success message.
});

const publishAVideo = asyncHandler(async (req, res) => {
  // 1. Get title and description from request body
  const { title, description } = req.body;

  // 2. Validate title and description
  if ([title, description].some((field) => !field || field.trim() === "")) {
    throw new ApiError(400, "Title and description are required");
  }

  // 3. Get local paths of video and thumbnail files
  // Assuming multer processes files and attaches them to req.files
  // where 'videoFile' and 'thumbnail' are the field names in your form.
  const videoFileLocalPath = req.files?.videoFile?.[0]?.path;
  const thumbnailLocalPath = req.files?.thumbnail?.[0]?.path;

  // 4. Validate file paths
  if (!videoFileLocalPath) {
    throw new ApiError(400, "Video file is required");
  }
  if (!thumbnailLocalPath) {
    throw new ApiError(400, "Thumbnail is required");
  }

  // 5. Upload video and thumbnail to Cloudinary
  const videoFile = await uploadOnCloudinary(videoFileLocalPath);
  const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);

  // 6. Check if Cloudinary uploads were successful
  if (!videoFile) {
    throw new ApiError(500, "Failed to upload video file to Cloudinary");
  }
  if (!thumbnail) {
    throw new ApiError(500, "Failed to upload thumbnail to Cloudinary");
  }

  // 7. Create a new video entry in the database
  const video = await Video.create({
    title,
    description,
    videoFile: videoFile.url,
    videoPublicId: videoFile.public_id, // Cloudinary URL for the video
    thumbnail: thumbnail.url,
    thumbnailPublicId: thumbnail.public_id, // Cloudinary URL for the thumbnail
    duration: videoFile.duration, // Cloudinary provides duration for videos
    owner: req.user?._id, // Assuming user information is available in req.user after authentication
    isPublished: true, // Default to true upon publishing
  });

  // 8. Check if video creation was successful
  if (!video) {
    throw new ApiError(500, "Something went wrong while publishing the video");
  }

  // 9. Return success response
  return res
    .status(201)
    .json(new ApiResponse(200, video, "Video published successfully!!"));
});

const getVideoById = asyncHandler(async (req, res) => {
  // 1. Extract videoId from request parameters
  const { videoId } = req.params;

  // 2. Validate videoId
  if (!videoId) {
    throw new ApiError(400, "Video ID is required");
  }
  if (!mongoose.Types.ObjectId.isValid(videoId)) {
    throw new ApiError(400, "Invalid Video ID");
  }

  // 3. Construct Aggregation Pipeline to find video and populate owner
  // Using aggregation provides more control over the output structure and selective field inclusion
  const video = await Video.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(videoId), // Match the video by its ID
      },
    },
    {
      // Lookup the owner's details from the 'users' collection
      $lookup: {
        from: "users", // The name of your users collection (usually lowercase and plural)
        localField: "owner", // Field in the video document
        foreignField: "_id", // Field in the users collection
        as: "ownerDetails", // Alias for the array of matching owner documents
        pipeline: [
          {
            // Project only necessary fields from the owner to avoid sending sensitive data
            $project: {
              username: 1,
              fullName: 1,
              avatar: 1,
              _id: 1, // Include _id for the owner
            },
          },
        ],
      },
    },
    {
      // Deconstruct the 'ownerDetails' array. Since 'owner' is usually a single reference,
      // this will turn the 'ownerDetails' array into a single object.
      $unwind: "$ownerDetails",
    },
    // Optional: You could add more lookups here for likes, comments count, etc.
    // {
    //     $lookup: {
    //         from: "likes", // Assuming a 'likes' collection
    //         localField: "_id",
    //         foreignField: "video",
    //         as: "likes"
    //     }
    // },
    // {
    //     $addFields: {
    //         likesCount: { $size: "$likes" },
    //         isLiked: {
    //             $cond: {
    //                 if: { $in: [req.user?._id, "$likes.likedBy"] }, // Check if current user liked it
    //                 then: true,
    //                 else: false
    //             }
    //         }
    //     }
    // },
    // {
    //     $project: {
    //         likes: 0 // Remove the raw likes array
    //     }
    // },
    {
      // Project (shape) the final output document
      $project: {
        videoFile: 1,
        thumbnail: 1,
        title: 1,
        description: 1,
        duration: 1,
        views: 1,
        isPublished: 1,
        createdAt: 1,
        updatedAt: 1,
        owner: {
          // Restructure owner details for a cleaner response
          _id: "$ownerDetails._id",
          username: "$ownerDetails.username",
          fullName: "$ownerDetails.fullName",
          avatar: "$ownerDetails.avatar",
        },
        // likesCount: 1, // If you added likes logic
        // isLiked: 1 // If you added likes logic
      },
    },
  ]);

  // 4. Handle video not found
  // If the aggregation returns an empty array, the video was not found
  if (!video || video.length === 0) {
    throw new ApiError(404, "Video not found");
  }

  // Since aggregation result is an array, get the first (and only) element
  const foundVideo = video[0];

  // 5. Increment video views
  // Use findByIdAndUpdate for this, as aggregation is for retrieval, not modification
  const updatedVideo = await Video.findByIdAndUpdate(
    videoId,
    { $inc: { views: 1 } }, // Increment the 'views' field by 1
    { new: true } // Return the updated document with the new view count
  );

  // Update the views count in the 'foundVideo' object before sending the response
  // to ensure the response reflects the incremented view.
  foundVideo.views = updatedVideo.views;

  // 6. Return the video details in a successful ApiResponse
  return res
    .status(200)
    .json(new ApiResponse(200, foundVideo, "Video fetched successfully"));
});

const updateVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  // 1. Validate videoId
  if (!videoId) {
    throw new ApiError(400, "Video ID is required");
  }
  if (!mongoose.Types.ObjectId.isValid(videoId)) {
    throw new ApiError(400, "Invalid Video ID");
  }

  // 2. Get update data from req.body and req.files (for new video/thumbnail files)
  const { title, description } = req.body;
  // req.files is populated by Multer. Ensure field names match Multer config.
  const videoFileLocalPath = req.files?.videoFile?.[0]?.path;
  const thumbnailLocalPath = req.files?.thumbnail?.[0]?.path;

  // 3. Check if at least one field for update is provided
  if (!title && !description && !videoFileLocalPath && !thumbnailLocalPath) {
    throw new ApiError(
      400,
      "At least one field (title, description, video, or thumbnail) is required to update."
    );
  }

  // 4. Find the existing video to be updated and verify ownership
  // We need to fetch the existing video to get its current Cloudinary public_ids for deletion
  const video = await Video.findById(videoId);

  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  // Authorization check: Ensure the authenticated user is the owner of the video
  // `req.user?._id` should be populated by your authentication middleware
  if (video.owner.toString() !== req.user?._id.toString()) {
    throw new ApiError(403, "You are not authorized to update this video");
  }

  const updateFields = {}; // Object to dynamically build the fields to be updated in MongoDB

  // Add title and description if provided
  if (title) {
    updateFields.title = title;
  }
  if (description) {
    updateFields.description = description;
  }

  // 5. Handle videoFile update (ONLY if a new video file is provided)
  if (videoFileLocalPath) {
    // console.log(`[UpdateVideo] Attempting to upload new video file from path: ${videoFileLocalPath}`);
    let newVideoFile;
    try {
      newVideoFile = await uploadOnCloudinary(videoFileLocalPath);
    } catch (uploadError) {
      console.error(
        "[UpdateVideo] Error caught during video upload via uploadOnCloudinary:",
        uploadError
      );
      throw new ApiError(
        500,
        "Failed to upload new video file due to an internal error."
      );
    }

    if (!newVideoFile || !newVideoFile.url || !newVideoFile.public_id) {
      console.error(
        `[UpdateVideo] Cloudinary video upload failed or returned incomplete data for path: ${videoFileLocalPath}`
      );
      throw new ApiError(
        500,
        "Error while uploading new video file to Cloudinary (no URL or public_id)"
      );
    }
    // console.log(`[UpdateVideo] New video file uploaded successfully. URL: ${newVideoFile.url}`);

    if (video.videoPublicId) {
      // console.log(`[UpdateVideo] Deleting old video file from Cloudinary: ${video.videoPublicId}`);
      await deleteFromCloudinary(video.videoPublicId, "video");
      // console.log(`[UpdateVideo] Old video file deletion initiated for: ${video.videoPublicId}`);
    } else {
      console.log("[UpdateVideo] No old video Public ID found to delete.");
    }
    // console.log(newVideoFile)

    updateFields.videoFile = newVideoFile.url;
    updateFields.videoPublicId = newVideoFile.public_id;
    updateFields.duration = newVideoFile.duration;
    // console.log("[UpdateVideo] Video file update fields prepared.");
  }

  // 6. Handle thumbnail update (ONLY if a new thumbnail file is provided)
  if (thumbnailLocalPath) {
    const newThumbnail = await uploadOnCloudinary(thumbnailLocalPath);
    if (!newThumbnail || !newThumbnail.url || !newThumbnail.public_id) {
      throw new ApiError(
        500,
        "Error while uploading new thumbnail to Cloudinary"
      );
    }

    // Delete the old thumbnail from Cloudinary (using its public_id)
    if (video.thumbnailPublicId) {
      // Check if there was an old thumbnail public_id to delete
      await deleteFromCloudinary(video.thumbnailPublicId, "image");
      // console.log(`Old thumbnail (ID: ${video.thumbnailPublicId}) deleted from Cloudinary.`);
    }

    // Update database fields with new thumbnail details
    updateFields.thumbnail = newThumbnail.url;
    updateFields.thumbnailPublicId = newThumbnail.public_id;
  }

  // 7. Update the video document in the database
  // Use $set to only update the fields that were actually provided in updateFields
  const updatedVideo = await Video.findByIdAndUpdate(
    videoId,
    { $set: updateFields },
    { new: true } // Return the updated document after the update operation
  ).select("-password"); // Assuming User model has a password field, but video model doesn't, so this select isn't strictly needed here unless you populate user in the response.

  if (!updatedVideo) {
    // This case indicates a potential race condition or that the video was deleted
    // between the initial findById and findByIdAndUpdate.
    throw new ApiError(
      500,
      "Something went wrong while updating the video. Video might have been deleted."
    );
  }

  // 8. Return the updated video details in a successful API response
  return res
    .status(200)
    .json(new ApiResponse(200, updatedVideo, "Video updated successfully"));
});

const deleteVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) {
    throw new ApiError(400, "Video ID is required");
  }
  if (!mongoose.Types.ObjectId.isValid(videoId)) {
    throw new ApiError(400, "Invalid Video ID");
  }

  // const deletedVideo = await Video.findByIdAndDelete(videoId)

  // if (!deleteVideo) {
  //     throw new ApiError(500, "Something went wrong while deleting video");
  // }

  const videoToDelete = await Video.findById(videoId);
  if (!videoToDelete) {
    throw new ApiError(404, "Video not found");
  }
  if (videoToDelete.owner.toString() !== req.user?._id.toString()) {
    throw new ApiError(403, "You are not authorized to delete this video");
  }
  if (videoToDelete.videoPublicId) {
    await deleteFromCloudinary(videoToDelete.videoPublicId, "video"); // Pass the URL or public_id
  }
  if (videoToDelete.thumbnailPublicId) {
    await deleteFromCloudinary(videoToDelete.thumbnailPublicId, "image"); // Pass the URL or public_id
  }

  const deletedLikesResult = await Like.deleteMany({ video: videoId });
  // console.log(
  //   `Deleted ${deletedLikesResult.deletedCount} likes associated with video ${videoId}`
  // );
  const deletedCommentResult = await Comment.deleteMany({ video: videoId });
  // console.log(
  //   `Deleted ${deletedCommentResult.deletedCount} comments associated with video ${videoId}`
  // );

  const deletedVideo = await Video.deleteOne({ _id: videoId });
  // console.log(deletedVideo)
  if (deletedVideo.deletedCount === 0) {
    throw new ApiError(500, "Failed to delete video from database");
  }
  return res
    .status(200)
    .json(new ApiResponse(200, deletedVideo, "Video deleted successfully"));
});

const togglePublishStatus = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) {
    throw new ApiError(400, "Video ID is required");
  }
  if (!mongoose.Types.ObjectId.isValid(videoId)) {
    throw new ApiError(400, "Invalid Video ID");
  }
  const video = await Video.findById(videoId);
  if (!video) {
    throw new ApiError(404, "Video not found");
  }
  if (video.owner.toString() !== req.user?._id.toString()) {
    throw new ApiError(
      403,
      "You are not authorized to toggle video publish status."
    );
  }
  const updatedVideo = await Video.findByIdAndUpdate(
    videoId,
    {
      $set: {
        isPublished: !video.isPublished, // Toggles the boolean value
      },
    },
    { new: true }
  );
  if (!updatedVideo) {
    throw new ApiError(
      500,
      "Something went wrong while toggling video publish status."
    );
  }
  return res.status(200).json(
    new ApiResponse(
      200,
      { isPublished: updatedVideo.isPublished }, // Only return the new status, or the full updated video
      "Video publish status toggled successfully"
    )
  );
});

export {
  getAllVideos,
  publishAVideo,
  getVideoById,
  updateVideo,
  deleteVideo,
  togglePublishStatus,
};
