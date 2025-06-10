// import mongoose, {isValidObjectId} from "mongoose"
// import {User} from "../models/user.model.js"
// import { Subscription } from "../models/subscription.model.js"
// import {ApiError} from "../utils/ApiError.js"
// import {ApiResponse} from "../utils/ApiResponse.js"
// import {asyncHandler} from "../utils/asyncHandler.js"


import mongoose from "mongoose"; // Ensure mongoose is imported for ObjectId validation
import { Subscription } from "../models/subscription.model.js"; // Adjust path as per your project structure
import { User } from "../models/user.model.js"; // Assuming you have a User model for channel validation
import { ApiError } from "../utils/ApiError.js"; // Your custom error class
import { ApiResponse } from "../utils/ApiResponse.js"; // Your custom API response class
import { asyncHandler } from "../utils/asyncHandler.js"; // Your async error handler

const toggleSubscription = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    // 1. Authenticate and get subscriber's ID
    // Assumes authentication middleware populates req.user
    if (!req.user || !req.user._id) {
        throw new ApiError(401, "User not authenticated. Please log in.");
    }
    const subscriberId = req.user._id;

    // 2. Validate channelId
    if (!mongoose.Types.ObjectId.isValid(channelId)) {
        throw new ApiError(400, "Invalid channel ID provided.");
    }

    // 3. Verify channel existence
    // It's good practice to ensure the 'channel' (user being subscribed to) actually exists
    const channelExists = await User.findById(channelId);
    if (!channelExists) {
        throw new ApiError(404, "Channel not found.");
    }

    // Optional: Prevent a user from subscribing to themselves
    if (subscriberId.toString() === channelId.toString()) {
        throw new ApiError(400, "You cannot subscribe to your own channel.");
    }

    // 4. Check for existing subscription
    const existingSubscription = await Subscription.findOne({
        subscriber: subscriberId,
        channel: channelId
    });

    let message;
    let newSubscriptionStatus;

    // 5. Toggle logic: Subscribe or Unsubscribe
    if (existingSubscription) {
        // If subscription exists, delete it (unsubscribe)
        await Subscription.deleteOne({ _id: existingSubscription._id });
        message = "Unsubscribed successfully.";
        newSubscriptionStatus = false;
    } else {
        // If no subscription exists, create one (subscribe)
        await Subscription.create({
            subscriber: subscriberId,
            channel: channelId
        });
        message = "Subscribed successfully.";
        newSubscriptionStatus = true;
    }

    // 6. Send response
    return res.status(200).json(
        new ApiResponse(
            200,
            { isSubscribed: newSubscriptionStatus, channelId: channelId },
            message
        )
    );
});


// controller to return subscriber list of a channel
const getUserChannelSubscribers = asyncHandler(async (req, res) => {
    const { channelId } = req.params;
    console.log(channelId)

    // 1. Validate channelId (optional but recommended)
    if (!channelId || !mongoose.Types.ObjectId.isValid(channelId)) {
        throw new ApiError(400, "Invalid channel ID provided.");
    }

    // 2. Find subscriptions where 'channel' matches channelId
    //    and populate the 'subscriber' field to get subscriber details.
    const subscribers = await Subscription.aggregate([
        {
            $match: {
                channel: new mongoose.Types.ObjectId(channelId)
            }
        },
        {
            $lookup: {
                from: "users", // The collection name for your User model (usually pluralized)
                localField: "subscriber",
                foreignField: "_id",
                as: "subscriberDetails"
            }
        },
        {
            $unwind: "$subscriberDetails" // Deconstructs the subscriberDetails array
        },
        {
            $project: {
                _id: 0, // Exclude the default _id from the subscription document
                subscriber: {
                    _id: "$subscriberDetails._id",
                    username: "$subscriberDetails.username",
                    email: "$subscriberDetails.email",
                    avatar: "$subscriberDetails.avatar", // Include other relevant user fields
                    fullName: "$subscriberDetails.fullName",
                    // ... other fields you want to expose about the subscriber
                }
            }
        }
    ]);

    // 3. Check if any subscribers were found
    if (!subscribers || subscribers.length === 0) {
        return res.status(200).json(new ApiResponse(200, [], "No subscribers found for this channel."));
    }

    // 4. Return the list of subscribers
    return res.status(200).json(new ApiResponse(200, subscribers.map(sub => sub.subscriber), "Subscribers fetched successfully."));
});

// controller to return channel list to which user has subscribed
const getSubscribedChannels = asyncHandler(async (req, res) => {
    const { subscriberId } = req.params;

    // Optional: Log for debugging
    console.log("Received subscriberId for subscribed channels:", subscriberId);
    console.log("Is subscriberId valid ObjectId?", mongoose.Types.ObjectId.isValid(subscriberId));


    // 1. Validate the subscriberId
    if (!subscriberId || !mongoose.Types.ObjectId.isValid(subscriberId)) {
        throw new ApiError(400, "Invalid subscriber ID provided.");
    }

    // 2. Find subscriptions where 'subscriber' matches subscriberId
    //    and populate the 'channel' field to get channel owner (User) details.
    const subscribedChannels = await Subscription.aggregate([
        {
            $match: {
                // We're looking for subscriptions where THIS user (subscriberId) is the one subscribing
                subscriber: new mongoose.Types.ObjectId(subscriberId)
            }
        },
        {
            $lookup: {
                from: "users", // The collection name for your User model (usually pluralized)
                localField: "channel",  // Field in Subscription model (the channel owner's ID)
                foreignField: "_id",    // Field in User model
                as: "channelDetails"
            }
        },
        {
            $unwind: "$channelDetails" // Deconstructs the channelDetails array
        },
        {
            $project: {
                _id: 0, // Exclude the default _id from the subscription document
                channel: {
                    _id: "$channelDetails._id",
                    username: "$channelDetails.username",
                    fullName: "$channelDetails.fullName",
                    avatar: "$channelDetails.avatar",
                    // Add any other user/channel fields you want to expose
                }
            }
        }
    ]);

    // 3. Check if any subscribed channels were found
    if (!subscribedChannels || subscribedChannels.length === 0) {
        return res.status(200).json(new ApiResponse(200, [], "This user has not subscribed to any channels."));
    }

    // 4. Return the list of subscribed channels
    return res.status(200).json(new ApiResponse(200, subscribedChannels.map(sub => sub.channel), "Subscribed channels fetched successfully."));
});

export {
    toggleSubscription,
    getUserChannelSubscribers,
    getSubscribedChannels
}