import { Op } from 'sequelize';
import {
  User,
  Interest,
  UserInterest,
  UserPhoto,
  Moment,
  MomentMedia,
  sequelize,
} from '../models';

export interface DummyUserProfileDef {
  id: string;
  username: string;
  email: string;
  fullName: string;
  firstName: string;
  nickName: string;
  gender: 'female' | 'male';
  genderPreference: 'men' | 'women' | 'everyone';
  dateOfBirth: string; // YYYY-MM-DD
  city: string;
  latitude: number;
  longitude: number;
  about: string;
  profilePicture: string;
  isFaceVerified: boolean;
  interests: string[];
  photos: string[];
  moments?: Array<{
    caption: string;
    mediaUrl: string;
    likesCount?: number;
    commentsCount?: number;
  }>;
}

export const DUMMY_DISCOVERY_PROFILES: DummyUserProfileDef[] = [
  // --- 25 FEMALE PROFILES ---
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    username: 'dummy_cindy',
    email: 'cindy.discovery@flirttime.app',
    fullName: 'Cindy Crawford',
    firstName: 'Cindy',
    nickName: 'Cindy',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1998-04-12',
    city: 'Indore, Madhya Pradesh',
    latitude: 22.7196,
    longitude: 75.8577,
    about: 'Sunday mood: coffee, playlist on shuffle and zero plans ☕🎶 Let us explore hidden cafes!',
    profilePicture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Cooking', 'Lyrics Music', 'Pets', 'Fitness', 'Travelling'],
    photos: [
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
    ],
    moments: [
      {
        caption: 'Sunday mood: coffee, playlist on shuffle and zero plans ☕🎶',
        mediaUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=80',
        likesCount: 24,
      },
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    username: 'dummy_meera',
    email: 'meera.discovery@flirttime.app',
    fullName: 'Meera Sharma',
    firstName: 'Meera',
    nickName: 'Meera',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1999-07-25',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Plant mom. Amateur chef. Sunset chaser at Marine Drive 🌅',
    profilePicture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Cooking', 'Reading', 'Art', 'Travelling'],
    photos: [
      'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80',
    ],
    moments: [
      {
        caption: 'Golden hour by the shore ✨',
        mediaUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
        likesCount: 88,
      },
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    username: 'dummy_ananya',
    email: 'ananya.discovery@flirttime.app',
    fullName: 'Ananya Verma',
    firstName: 'Ananya',
    nickName: 'Anu',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '2000-01-18',
    city: 'Bengaluru, Karnataka',
    latitude: 12.9716,
    longitude: 77.5946,
    about: 'UI Designer by day, karaoke superstar on weekends 🎤 Loves filter coffee and indie pop.',
    profilePicture: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Karaoke', 'Gaming', 'Music', 'Fitness'],
    photos: [
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000004',
    username: 'dummy_rhea',
    email: 'rhea.discovery@flirttime.app',
    fullName: 'Rhea Kapoor',
    firstName: 'Rhea',
    nickName: 'Rhee',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1997-11-09',
    city: 'Delhi, NCR',
    latitude: 28.6139,
    longitude: 77.209,
    about: 'Hopeless romantic who loves street food, art galleries, and endless road trips 🚗💨',
    profilePicture: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Art', 'Travelling', 'Photography', 'Shopping'],
    photos: [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000005',
    username: 'dummy_aisha',
    email: 'aisha.discovery@flirttime.app',
    fullName: 'Aisha Khan',
    firstName: 'Aisha',
    nickName: 'Aishu',
    gender: 'female',
    genderPreference: 'everyone',
    dateOfBirth: '1999-09-14',
    city: 'Pune, Maharashtra',
    latitude: 18.5204,
    longitude: 73.8567,
    about: 'Architecture graduate with a passion for live concerts, pottery, and dog parks 🐶',
    profilePicture: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Pets', 'Music', 'Art', 'Dance'],
    photos: [
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000006',
    username: 'dummy_tara',
    email: 'tara.discovery@flirttime.app',
    fullName: 'Tara Deshmukh',
    firstName: 'Tara',
    nickName: 'Tara',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1998-03-30',
    city: 'Indore, Madhya Pradesh',
    latitude: 22.7196,
    longitude: 75.8577,
    about: 'Fitness enthusiast, avid reader, and sourdough experimenter 🥖 Looking for genuine conversations.',
    profilePicture: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Fitness', 'Reading', 'Cooking', 'Yoga'],
    photos: [
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000007',
    username: 'dummy_diya',
    email: 'diya.discovery@flirttime.app',
    fullName: 'Diya Patel',
    firstName: 'Diya',
    nickName: 'Diyu',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '2001-05-20',
    city: 'Ahmedabad, Gujarat',
    latitude: 23.0225,
    longitude: 72.5714,
    about: 'Life is too short for bad coffee and boring playlists 🎧 Tell me your favorite travel story!',
    profilePicture: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: false,
    interests: ['Travelling', 'Music', 'Photography', 'Shopping'],
    photos: [
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000008',
    username: 'dummy_kiara',
    email: 'kiara.discovery@flirttime.app',
    fullName: 'Kiara Advani',
    firstName: 'Kiara',
    nickName: 'Kia',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1999-08-11',
    city: 'Goa',
    latitude: 15.2993,
    longitude: 74.124,
    about: 'Beach vibes only 🌊 Scuba diver, sunset admirer, and always up for sushi.',
    profilePicture: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Swimming', 'Travelling', 'Party', 'Drinks'],
    photos: [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000009',
    username: 'dummy_pooja',
    email: 'pooja.discovery@flirttime.app',
    fullName: 'Pooja Hegde',
    firstName: 'Pooja',
    nickName: 'Pooja',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1997-10-13',
    city: 'Hyderabad, Telangana',
    latitude: 17.385,
    longitude: 78.4867,
    about: 'Foodie with a serious love for biryani and spicy debates over Marvel vs DC 🎬',
    profilePicture: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Cooking', 'Gaming', 'Movies', 'Music'],
    photos: [
      'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000010',
    username: 'dummy_sneha',
    email: 'sneha.discovery@flirttime.app',
    fullName: 'Sneha Reddy',
    firstName: 'Sneha',
    nickName: 'Snehu',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '2000-06-22',
    city: 'Bengaluru, Karnataka',
    latitude: 12.9716,
    longitude: 77.5946,
    about: 'Product manager navigating startup chaos with yoga and cold brews 🧘‍♀️✨',
    profilePicture: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Yoga', 'Fitness', 'Reading', 'Travelling'],
    photos: [
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000011',
    username: 'dummy_tanvi',
    email: 'tanvi.discovery@flirttime.app',
    fullName: 'Tanvi Rao',
    firstName: 'Tanvi',
    nickName: 'Tanu',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1998-12-05',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Fashion stylist with a love for vintage vinyl and spontaneous weekend escapes 🌸',
    profilePicture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Shopping', 'Art', 'Dance', 'Photography'],
    photos: [
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000012',
    username: 'dummy_kavya',
    email: 'kavya.discovery@flirttime.app',
    fullName: 'Kavya Nair',
    firstName: 'Kavya',
    nickName: 'Kav',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '2001-02-14',
    city: 'Kochi, Kerala',
    latitude: 9.9312,
    longitude: 76.2673,
    about: 'Backwaters, good books, and spicy tea ☕ Tell me what makes you laugh the hardest!',
    profilePicture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: false,
    interests: ['Reading', 'Travelling', 'Photography', 'Art'],
    photos: [
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000013',
    username: 'dummy_riya',
    email: 'riya.discovery@flirttime.app',
    fullName: 'Riya Sen',
    firstName: 'Riya',
    nickName: 'Riyu',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1999-04-18',
    city: 'Kolkata, West Bengal',
    latitude: 22.5726,
    longitude: 88.3639,
    about: 'Poetry, monsoon coffee, and Rabindra sangeet vibes 🌧️ Looking for deep chats.',
    profilePicture: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Music', 'Reading', 'Art', 'Dance'],
    photos: [
      'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000014',
    username: 'dummy_ishita',
    email: 'ishita.discovery@flirttime.app',
    fullName: 'Ishita Roy',
    firstName: 'Ishita',
    nickName: 'Ishu',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1997-08-29',
    city: 'Delhi, NCR',
    latitude: 28.6139,
    longitude: 77.209,
    about: 'Corporate lawyer by day, standup comedy fan by night 🎤 Let us grab dinner and judge people.',
    profilePicture: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Party', 'Drinks', 'Tennis', 'Fitness'],
    photos: [
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000015',
    username: 'dummy_natasha',
    email: 'natasha.discovery@flirttime.app',
    fullName: 'Natasha Singh',
    firstName: 'Natasha',
    nickName: 'Nat',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '2000-03-17',
    city: 'Chandigarh',
    latitude: 30.7333,
    longitude: 76.7794,
    about: 'Sucker for golden retrievers, mountain treks, and hot chocolate in winter 🏔️',
    profilePicture: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Pets', 'Running', 'Travelling', 'Fitness'],
    photos: [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000016',
    username: 'dummy_simran',
    email: 'simran.discovery@flirttime.app',
    fullName: 'Simran Kaur',
    firstName: 'Simran',
    nickName: 'Simi',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1998-10-04',
    city: 'Delhi, NCR',
    latitude: 28.6139,
    longitude: 77.209,
    about: 'Big foodie, classical dancer, and full-time overthinker. Always down for late drives 🚗',
    profilePicture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Dance', 'Cooking', 'Music', 'Shopping'],
    photos: [
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000017',
    username: 'dummy_sanjana',
    email: 'sanjana.discovery@flirttime.app',
    fullName: 'Sanjana Mehta',
    firstName: 'Sanjana',
    nickName: 'Sanju',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '2001-09-12',
    city: 'Jaipur, Rajasthan',
    latitude: 26.9124,
    longitude: 75.7873,
    about: 'Jewelry designer exploring royal palaces and vintage bazaars ✨ Coffee first, always.',
    profilePicture: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Shopping', 'Art', 'Travelling', 'Photography'],
    photos: [
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000018',
    username: 'dummy_alisha',
    email: 'alisha.discovery@flirttime.app',
    fullName: 'Alisha Chinai',
    firstName: 'Alisha',
    nickName: 'Ali',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1999-12-28',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Journalist who loves indie concerts, rooftop bars, and candid street photography 📸',
    profilePicture: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: false,
    interests: ['Photography', 'Music', 'Drinks', 'Party'],
    photos: [
      'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000019',
    username: 'dummy_divya',
    email: 'divya.discovery@flirttime.app',
    fullName: 'Divya Bharti',
    firstName: 'Divya',
    nickName: 'Divi',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1997-05-19',
    city: 'Indore, Madhya Pradesh',
    latitude: 22.7196,
    longitude: 75.8577,
    about: 'Chai lover, kathak dancer, and software engineer. Looking for someone with a great sense of humor 😄',
    profilePicture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Dance', 'Cooking', 'Gaming', 'Travelling'],
    photos: [
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000020',
    username: 'dummy_maya',
    email: 'maya.discovery@flirttime.app',
    fullName: 'Maya Joshi',
    firstName: 'Maya',
    nickName: 'Maya',
    gender: 'female',
    genderPreference: 'everyone',
    dateOfBirth: '2000-07-07',
    city: 'Pune, Maharashtra',
    latitude: 18.5204,
    longitude: 73.8567,
    about: 'Animal shelter volunteer & nature enthusiast. Let us go on a hike or binge anime! 🌿',
    profilePicture: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Pets', 'Fitness', 'Art', 'Video games'],
    photos: [
      'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000021',
    username: 'dummy_zoya',
    email: 'zoya.discovery@flirttime.app',
    fullName: 'Zoya Akhtar',
    firstName: 'Zoya',
    nickName: 'Zo',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1998-02-11',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Film enthusiast & aspiring scriptwriter. Looking for someone to debate cinema with 🎬✨',
    profilePicture: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Art', 'Reading', 'Travelling', 'Music'],
    photos: [
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000022',
    username: 'dummy_shruti',
    email: 'shruti.discovery@flirttime.app',
    fullName: 'Shruti Haasan',
    firstName: 'Shruti',
    nickName: 'Shru',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1999-05-03',
    city: 'Hyderabad, Telangana',
    latitude: 17.385,
    longitude: 78.4867,
    about: 'Rock music, dark roast espresso, and weekend road trips 🎸 Say hi if you love live gigs.',
    profilePicture: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Music', 'Party', 'Drinks', 'Tennis'],
    photos: [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000023',
    username: 'dummy_tanya',
    email: 'tanya.discovery@flirttime.app',
    fullName: 'Tanya Singhania',
    firstName: 'Tanya',
    nickName: 'Tani',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '2000-11-23',
    city: 'Delhi, NCR',
    latitude: 28.6139,
    longitude: 77.209,
    about: 'Pastry chef in the making 🧁 Will bake you cookies if you are nice to me.',
    profilePicture: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Cooking', 'Shopping', 'Dance', 'Pets'],
    photos: [
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000024',
    username: 'dummy_kriti',
    email: 'kriti.discovery@flirttime.app',
    fullName: 'Kriti Sanon',
    firstName: 'Kriti',
    nickName: 'Kriti',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1997-07-27',
    city: 'Indore, Madhya Pradesh',
    latitude: 22.7196,
    longitude: 75.8577,
    about: 'Engineer turned content creator. Pilates addict, sunset watcher, and dog cuddler 🐾',
    profilePicture: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Fitness', 'Yoga', 'Pets', 'Travelling'],
    photos: [
      'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000025',
    username: 'dummy_sara',
    email: 'sara.discovery@flirttime.app',
    fullName: 'Sara Ali',
    firstName: 'Sara',
    nickName: 'Sara',
    gender: 'female',
    genderPreference: 'men',
    dateOfBirth: '1999-08-12',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Spontaneous trips, bad puns, and street food hopping 🌮 Let us find the best chai in town.',
    profilePicture: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Travelling', 'Cooking', 'Art', 'Shopping'],
    photos: [
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
    ],
  },

  // --- 25 MALE PROFILES ---
  {
    id: 'a0000000-0000-4000-8000-000000000026',
    username: 'dummy_alex',
    email: 'alex.discovery@flirttime.app',
    fullName: 'Alex Rivers',
    firstName: 'Alex',
    nickName: 'Alex',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1997-03-15',
    city: 'Indore, Madhya Pradesh',
    latitude: 22.7196,
    longitude: 75.8577,
    about: 'Planning the next getaway. Suggestions welcome 🗺️ Nature lover & photography geek.',
    profilePicture: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Travelling', 'Photography', 'Sports', 'Fitness'],
    photos: [
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    ],
    moments: [
      {
        caption: 'Planning the next getaway. Suggestions welcome 🗺️',
        mediaUrl: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80',
        likesCount: 14,
      },
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000027',
    username: 'dummy_aarav',
    email: 'aarav.discovery@flirttime.app',
    fullName: 'Aarav Mehta',
    firstName: 'Aarav',
    nickName: 'Aaru',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1996-09-20',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Tech founder, amateur guitarist, and coffee connoisseur 🎸 Let us debate startups or sci-fi.',
    profilePicture: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Music', 'Fitness', 'Gaming', 'Travelling'],
    photos: [
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    ],
    moments: [
      {
        caption: 'Forest walks reset everything 🌲',
        mediaUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80',
        likesCount: 21,
      },
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000028',
    username: 'dummy_kabir',
    email: 'kabir.discovery@flirttime.app',
    fullName: 'Kabir Thapar',
    firstName: 'Kabir',
    nickName: 'Kabir',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1995-12-08',
    city: 'Delhi, NCR',
    latitude: 28.6139,
    longitude: 77.209,
    about: 'Architect who loves heritage walks, craft beer, and vinyl records 🍺 What is your go-to weekend plan?',
    profilePicture: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Art', 'Drinks', 'Travelling', 'Photography'],
    photos: [
      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000029',
    username: 'dummy_rohan',
    email: 'rohan.discovery@flirttime.app',
    fullName: 'Rohan Nanda',
    firstName: 'Rohan',
    nickName: 'Ro',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1998-05-14',
    city: 'Bengaluru, Karnataka',
    latitude: 12.9716,
    longitude: 77.5946,
    about: 'Marathon runner & software engineer 🏃‍♂️ Can cook killer pasta and knows the best breakfast joints.',
    profilePicture: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Running', 'Cooking', 'Fitness', 'Sports'],
    photos: [
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000030',
    username: 'dummy_siddharth',
    email: 'siddharth.discovery@flirttime.app',
    fullName: 'Siddharth Malhotra',
    firstName: 'Siddharth',
    nickName: 'Sid',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1996-01-16',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Fitness trainer & golden retriever dad 🐕 Love late-night marine drive drives and acoustic jams.',
    profilePicture: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Fitness', 'Pets', 'Music', 'Swimming'],
    photos: [
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000031',
    username: 'dummy_arjun',
    email: 'arjun.discovery@flirttime.app',
    fullName: 'Arjun Kapoor',
    firstName: 'Arjun',
    nickName: 'Arjun',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1997-06-26',
    city: 'Pune, Maharashtra',
    latitude: 18.5204,
    longitude: 73.8567,
    about: 'Mechanical engineer with a passion for bikes, trekking in Sahyadris, and spicy misal pav 🏍️',
    profilePicture: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Travelling', 'Sports', 'Photography', 'Fitness'],
    photos: [
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000032',
    username: 'dummy_ishan',
    email: 'ishan.discovery@flirttime.app',
    fullName: 'Ishan Khattar',
    firstName: 'Ishan',
    nickName: 'Ishan',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1999-11-01',
    city: 'Delhi, NCR',
    latitude: 28.6139,
    longitude: 77.209,
    about: 'Dancer, cinephile, and weekend football player ⚽ Looking for good energy and genuine smiles.',
    profilePicture: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: false,
    interests: ['Dance', 'Sports', 'Gaming', 'Music'],
    photos: [
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000033',
    username: 'dummy_vikram',
    email: 'vikram.discovery@flirttime.app',
    fullName: 'Vikram Rathore',
    firstName: 'Vikram',
    nickName: 'Vicky',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1995-04-10',
    city: 'Jaipur, Rajasthan',
    latitude: 26.9124,
    longitude: 75.7873,
    about: 'Hospitality professional who loves hosting dinner parties and exploring desert night skies ✨',
    profilePicture: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Cooking', 'Travelling', 'Art', 'Drinks'],
    photos: [
      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000034',
    username: 'dummy_aditya',
    email: 'aditya.discovery@flirttime.app',
    fullName: 'Aditya Roy',
    firstName: 'Aditya',
    nickName: 'Adi',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1996-11-16',
    city: 'Goa',
    latitude: 15.2993,
    longitude: 74.124,
    about: 'Musician & surfer 🏄‍♂️ Living between beach sunsets and recording studios. Hit me with music recs.',
    profilePicture: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Music', 'Swimming', 'Party', 'Drinks'],
    photos: [
      'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000035',
    username: 'dummy_dev',
    email: 'dev.discovery@flirttime.app',
    fullName: 'Dev Singhania',
    firstName: 'Dev',
    nickName: 'Dev',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1998-02-28',
    city: 'Kolkata, West Bengal',
    latitude: 22.5726,
    longitude: 88.3639,
    about: 'Photographer & visual artist. Loves old city alleys, dark chocolate, and soulful jazz 🎺',
    profilePicture: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Photography', 'Art', 'Music', 'Reading'],
    photos: [
      'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000036',
    username: 'dummy_rahul',
    email: 'rahul.discovery@flirttime.app',
    fullName: 'Rahul Khanna',
    firstName: 'Rahul',
    nickName: 'Rahul',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1997-08-05',
    city: 'Chandigarh',
    latitude: 30.7333,
    longitude: 76.7794,
    about: 'Sports fanatic, dog dad, and food lover. Always ready for a road trip to the hills 🚙',
    profilePicture: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Sports', 'Pets', 'Fitness', 'Travelling'],
    photos: [
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000037',
    username: 'dummy_aryan',
    email: 'aryan.discovery@flirttime.app',
    fullName: 'Aryan Khan',
    firstName: 'Aryan',
    nickName: 'Ary',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1999-10-12',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Fashion designer & creative director. Into techno music, modern architecture, and street fashion.',
    profilePicture: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Art', 'Party', 'Music', 'Shopping'],
    photos: [
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000038',
    username: 'dummy_vivaan',
    email: 'vivaan.discovery@flirttime.app',
    fullName: 'Vivaan Oberoi',
    firstName: 'Vivaan',
    nickName: 'Viv',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '2000-04-09',
    city: 'Bengaluru, Karnataka',
    latitude: 12.9716,
    longitude: 77.5946,
    about: 'AI researcher by day, board game geek by night 🎲 Tell me your top 3 guilty pleasure songs.',
    profilePicture: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Gaming', 'Video games', 'Reading', 'Music'],
    photos: [
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000039',
    username: 'dummy_dhruv',
    email: 'dhruv.discovery@flirttime.app',
    fullName: 'Dhruv Rathee',
    firstName: 'Dhruv',
    nickName: 'Dhruv',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1996-03-22',
    city: 'Delhi, NCR',
    latitude: 28.6139,
    longitude: 77.209,
    about: 'Scuba diver & documentary maker 🎥 Love visiting off-beat places where Wi-Fi does not exist.',
    profilePicture: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Travelling', 'Swimming', 'Photography', 'Art'],
    photos: [
      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000040',
    username: 'dummy_reyansh',
    email: 'reyansh.discovery@flirttime.app',
    fullName: 'Reyansh Rawat',
    firstName: 'Reyansh',
    nickName: 'Rey',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1998-11-19',
    city: 'Indore, Madhya Pradesh',
    latitude: 22.7196,
    longitude: 75.8577,
    about: 'Finance analyst with a creative heart. Love playing tennis, hiking trails, and brunch dates 🎾',
    profilePicture: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Tennis', 'Fitness', 'Cooking', 'Travelling'],
    photos: [
      'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000041',
    username: 'dummy_neil',
    email: 'neil.discovery@flirttime.app',
    fullName: 'Neil Nitin',
    firstName: 'Neil',
    nickName: 'Neil',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1997-01-25',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Actor & fitness fanatic. Big fan of 90s rock, Italian food, and spontaneous beach trips.',
    profilePicture: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Fitness', 'Cooking', 'Music', 'Swimming'],
    photos: [
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000042',
    username: 'dummy_sameer',
    email: 'sameer.discovery@flirttime.app',
    fullName: 'Sameer Roy',
    firstName: 'Sameer',
    nickName: 'Sam',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '2000-08-30',
    city: 'Hyderabad, Telangana',
    latitude: 17.385,
    longitude: 78.4867,
    about: 'Gamer, programmer, and dog lover 🎮 Looking for someone to beat in Mario Kart.',
    profilePicture: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: false,
    interests: ['Gaming', 'Video games', 'Pets', 'Music'],
    photos: [
      'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000043',
    username: 'dummy_yash',
    email: 'yash.discovery@flirttime.app',
    fullName: 'Yash Chopra',
    firstName: 'Yash',
    nickName: 'Yash',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1998-07-11',
    city: 'Indore, Madhya Pradesh',
    latitude: 22.7196,
    longitude: 75.8577,
    about: 'Coffee aficionado & photography enthusiast. Let us capture cool memories together ☕📸',
    profilePicture: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Photography', 'Travelling', 'Fitness', 'Art'],
    photos: [
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000044',
    username: 'dummy_kunal',
    email: 'kunal.discovery@flirttime.app',
    fullName: 'Kunal Khemu',
    firstName: 'Kunal',
    nickName: 'Kunal',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1996-05-25',
    city: 'Pune, Maharashtra',
    latitude: 18.5204,
    longitude: 73.8567,
    about: 'Biker, traveler, and stand-up comedy regular. Life is best lived outside your comfort zone.',
    profilePicture: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Travelling', 'Sports', 'Party', 'Drinks'],
    photos: [
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000045',
    username: 'dummy_varun',
    email: 'varun.discovery@flirttime.app',
    fullName: 'Varun Dhawan',
    firstName: 'Varun',
    nickName: 'VD',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1997-04-24',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Energetic dancer, gym rat, and big believer in spontaneous dance-offs 🕺 Let us vibe!',
    profilePicture: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Dance', 'Fitness', 'Exercise', 'Music'],
    photos: [
      'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000046',
    username: 'dummy_nikhil',
    email: 'nikhil.discovery@flirttime.app',
    fullName: 'Nikhil Advani',
    firstName: 'Nikhil',
    nickName: 'Nik',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1998-10-18',
    city: 'Bengaluru, Karnataka',
    latitude: 12.9716,
    longitude: 77.5946,
    about: 'Startup engineer who cooks gourmet meals on Sunday and hikes mountains on Saturday 🍳⛰️',
    profilePicture: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Cooking', 'Running', 'Travelling', 'Fitness'],
    photos: [
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000047',
    username: 'dummy_aman',
    email: 'aman.discovery@flirttime.app',
    fullName: 'Aman Gupta',
    firstName: 'Aman',
    nickName: 'Aman',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1996-08-03',
    city: 'Delhi, NCR',
    latitude: 28.6139,
    longitude: 77.209,
    about: 'Music lover with an obsession for audio gear and rooftop DJ sets 🎧 Let us share playlists.',
    profilePicture: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Music', 'Party', 'Karaoke', 'Gaming'],
    photos: [
      'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000048',
    username: 'dummy_armaan',
    email: 'armaan.discovery@flirttime.app',
    fullName: 'Armaan Malik',
    firstName: 'Armaan',
    nickName: 'Armaan',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1999-07-22',
    city: 'Mumbai, Maharashtra',
    latitude: 19.076,
    longitude: 72.8777,
    about: 'Singer, songwriter, and romantic at heart. Coffee, guitars, and stargazing 🌟',
    profilePicture: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Music', 'Karaoke', 'Lyrics Music', 'Travelling'],
    photos: [
      'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000049',
    username: 'dummy_rishabh',
    email: 'rishabh.discovery@flirttime.app',
    fullName: 'Rishabh Pant',
    firstName: 'Rishabh',
    nickName: 'Rishu',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1998-10-04',
    city: 'Delhi, NCR',
    latitude: 28.6139,
    longitude: 77.209,
    about: 'Cricket lover, gym addict, and always ready for street food in Old Delhi 🏏',
    profilePicture: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Sports', 'Fitness', 'Exercise', 'Cooking'],
    photos: [
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    ],
  },
  {
    id: 'a0000000-0000-4000-8000-000000000050',
    username: 'dummy_harsh',
    email: 'harsh.discovery@flirttime.app',
    fullName: 'Harsh Vardhan',
    firstName: 'Harsh',
    nickName: 'Harsh',
    gender: 'male',
    genderPreference: 'women',
    dateOfBirth: '1997-12-14',
    city: 'Jaipur, Rajasthan',
    latitude: 26.9124,
    longitude: 75.7873,
    about: 'Heritage explorer, book collector, and chai fanatic ☕ Let us have conversations that go past midnight.',
    profilePicture: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=800&q=80',
    isFaceVerified: true,
    interests: ['Reading', 'Travelling', 'Art', 'Photography'],
    photos: [
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    ],
  },
];

/**
 * Seeds 50 high-quality dummy users for people discovery into the database.
 * Completely idempotent: if user exists by ID or username, updates fields without duplicate insertion.
 */
export const seed50DiscoveryUsers = async (forceUpdate = false): Promise<{
  created: number;
  updated: number;
  total: number;
}> => {
  let createdCount = 0;
  let updatedCount = 0;

  try {
    // 1. Fetch all interests to map names to IDs
    const allInterests = await Interest.findAll({ where: { isActive: true } });
    const interestMap = new Map<string, string>();
    for (const inst of allInterests) {
      interestMap.set(inst.name.toLowerCase(), inst.id);
    }

    for (const def of DUMMY_DISCOVERY_PROFILES) {
      // Find or create User
      const [user, created] = await User.findOrCreate({
        where: {
          [Op.or]: [{ id: def.id }, { username: def.username }, { email: def.email }],
        },
        defaults: {
          id: def.id,
          username: def.username,
          email: def.email,
          fullName: def.fullName,
          firstName: def.firstName,
          nickName: def.nickName,
          gender: def.gender,
          genderPreference: def.genderPreference,
          dateOfBirth: def.dateOfBirth,
          city: def.city,
          latitude: def.latitude,
          longitude: def.longitude,
          about: def.about,
          profilePicture: def.profilePicture,
          isFaceVerified: def.isFaceVerified,
          faceVerifiedAt: def.isFaceVerified ? new Date() : null,
          isProfileComplete: true,
          isActive: true,
          role: 'user',
        },
      });

      if (created) {
        createdCount++;
      } else if (forceUpdate) {
        user.fullName = def.fullName;
        user.firstName = def.firstName;
        user.nickName = def.nickName;
        user.city = def.city;
        user.latitude = def.latitude;
        user.longitude = def.longitude;
        user.about = def.about;
        user.profilePicture = def.profilePicture;
        user.isFaceVerified = def.isFaceVerified;
        user.isProfileComplete = true;
        user.isActive = true;
        await user.save();
        updatedCount++;
      }

      const targetUserId = user.id;

      // 2. Attach Primary & Additional Photos in UserPhoto
      await UserPhoto.findOrCreate({
        where: { userId: targetUserId, imageUrl: def.profilePicture },
        defaults: {
          userId: targetUserId,
          imageUrl: def.profilePicture,
          isPrimary: true,
          displayOrder: 0,
          status: 'approved',
        },
      });

      for (let i = 0; i < def.photos.length; i++) {
        const photoUrl = def.photos[i];
        await UserPhoto.findOrCreate({
          where: { userId: targetUserId, imageUrl: photoUrl },
          defaults: {
            userId: targetUserId,
            imageUrl: photoUrl,
            isPrimary: false,
            displayOrder: i + 1,
            status: 'approved',
          },
        });
      }

      // 3. Attach UserInterests
      for (const interestName of def.interests) {
        const interestId = interestMap.get(interestName.toLowerCase());
        if (interestId) {
          await UserInterest.findOrCreate({
            where: { userId: targetUserId, interestId },
            defaults: { userId: targetUserId, interestId },
          });
        }
      }

      // 4. Attach sample Moments if defined
      if (def.moments && def.moments.length > 0) {
        for (const momentDef of def.moments) {
          const existingMoment = await Moment.findOne({
            where: { userId: targetUserId, caption: momentDef.caption },
          });
          if (!existingMoment) {
            const m = await Moment.create({
              userId: targetUserId,
              caption: momentDef.caption,
              audience: 'everyone',
              status: 'active',
              publishedAt: new Date(),
              expiresAt: null,
              locationLabel: def.city,
            });

            await MomentMedia.create({
              momentId: m.id,
              mediaUrl: momentDef.mediaUrl,
              mediaType: 'image',
              displayOrder: 0,
            });
          }
        }
      }
    }

    // 5. Seed sample Quick Moments (Stories matching Image 1, 2, and 3)
    try {
      const { QuickMoment, QuickMomentReaction } = await import('../models');
      const alexId = 'a0000000-0000-4000-8000-000000000026';
      const cindyId = 'a0000000-0000-4000-8000-000000000001';
      const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Alex's text story: "Who's up for coffee this evening? ☕" (Image 2)
      let alexStory = await QuickMoment.findOne({
        where: { userId: alexId, text: "Who's up for coffee this evening? ☕" },
      });
      if (!alexStory) {
        alexStory = await QuickMoment.create({
          userId: alexId,
          type: 'text',
          text: "Who's up for coffee this evening? ☕",
          backgroundColor: '#2d0b1e',
          textColor: '#ffffff',
          viewsCount: 14,
          repliesCount: 2,
          status: 'active',
          publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hr ago
          expiresAt: futureExpiry,
        });

        // Add 3 reactions (😍, 🔥, 😍) from dummy users
        const reactorIds = [
          'a0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000002',
          'a0000000-0000-4000-8000-000000000003',
        ];
        const emojis = ['😍', '🔥', '😍'];
        for (let i = 0; i < reactorIds.length; i++) {
          await QuickMomentReaction.findOrCreate({
            where: { quickMomentId: alexStory.id, userId: reactorIds[i] },
            defaults: { quickMomentId: alexStory.id, userId: reactorIds[i], emoji: emojis[i] },
          });
        }
      }

      // Cindy's image story: Coffee date with myself ☕ (Image 3)
      let cindyStory = await QuickMoment.findOne({
        where: { userId: cindyId, caption: 'Coffee date with myself ☕' },
      });
      if (!cindyStory) {
        cindyStory = await QuickMoment.create({
          userId: cindyId,
          type: 'image',
          mediaUrl: 'https://images.unsplash.com/photo-1509785307050-d4066910ec1e?auto=format&fit=crop&w=800&q=80',
          thumbnailUrl: 'https://images.unsplash.com/photo-1509785307050-d4066910ec1e?auto=format&fit=crop&w=800&q=80',
          caption: 'Coffee date with myself ☕',
          locationLabel: '📍 Indore, Madhya Pradesh',
          viewsCount: 28,
          repliesCount: 4,
          status: 'active',
          publishedAt: new Date(Date.now() - 48 * 60 * 1000), // 48 min ago
          expiresAt: futureExpiry,
        });

        // Add 5 reactions (😍, 🔥, 😍, ❤️, 😍) -> Badge: "😍 5"
        const cindyReactors = [
          'a0000000-0000-4000-8000-000000000026',
          'a0000000-0000-4000-8000-000000000027',
          'a0000000-0000-4000-8000-000000000028',
          'a0000000-0000-4000-8000-000000000029',
          'a0000000-0000-4000-8000-000000000030',
        ];
        const cindyEmojis = ['😍', '😍', '😍', '🔥', '❤️'];
        for (let i = 0; i < cindyReactors.length; i++) {
          await QuickMomentReaction.findOrCreate({
            where: { quickMomentId: cindyStory.id, userId: cindyReactors[i] },
            defaults: { quickMomentId: cindyStory.id, userId: cindyReactors[i], emoji: cindyEmojis[i] },
          });
        }
      }
    } catch (qmErr: any) {
      console.warn('⚠️ Could not seed sample quick moments:', qmErr.message);
    }

    console.log(
      `✅ Seeded 50 discovery users: ${createdCount} created, ${updatedCount} updated, total: 50.`
    );
  } catch (error: any) {
    console.error('❌ Error seeding 50 discovery users:', error.message);
  }

  return {
    created: createdCount,
    updated: updatedCount,
    total: DUMMY_DISCOVERY_PROFILES.length,
  };
};
